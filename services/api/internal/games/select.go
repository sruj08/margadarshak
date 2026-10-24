package games

import (
	"fmt"
	"math/rand/v2"
	"sort"
	"strconv"
	"strings"
)

// Item choice by game and mode (plan §2.3 select.go). Every choice is drawn from a PRNG seeded
// with the session seed, so a session's selection can be reproduced from its seed and inputs.

// Session sizes that are product decisions rather than rule-pack values.
const (
	nazarPracticeClips = 3 // NAZAR §1: 1–5 clips by staircase
	nazarLearnClips    = 2
	llPracticeItems    = 10
)

func newRNG(seed uint32) *rand.Rand {
	return rand.New(rand.NewPCG(uint64(seed), 0x6d61726764617273)) // "margdars"
}

// selectNazarMock picks n unseen, mock-eligible clips spread across curator difficulty 2–4
// (GAME_SDK §7: Kerala mode draws clips across difficulty 2–4), one version per clip ID. It fails
// with ErrNoUnseenClips when fewer than n qualify.
func selectNazarMock(candidates []ClipItem, seen map[string]bool, n int, rng *rand.Rand) ([]ClipItem, error) {
	buckets := map[int][]ClipItem{}
	used := map[string]bool{}
	for _, c := range candidates {
		if seen[c.ClipID] || used[c.ClipID] || c.CuratorDifficulty < 2 || c.CuratorDifficulty > 4 {
			continue
		}
		used[c.ClipID] = true
		buckets[c.CuratorDifficulty] = append(buckets[c.CuratorDifficulty], c)
	}
	total := len(buckets[2]) + len(buckets[3]) + len(buckets[4])
	if total < n {
		return nil, fmt.Errorf("%w: %d unseen clips at difficulty 2–4, need %d", ErrNoUnseenClips, total, n)
	}
	for d := 2; d <= 4; d++ {
		b := buckets[d]
		sort.Slice(b, func(i, j int) bool { return b[i].Ref < b[j].Ref }) // deterministic before shuffling
		rng.Shuffle(len(b), func(i, j int) { b[i], b[j] = b[j], b[i] })
	}
	// Round-robin 3, 2, 4 so a ten-clip form is 4/3/3; an empty bucket is skipped.
	var out []ClipItem
	for len(out) < n {
		for _, d := range []int{3, 2, 4} {
			if len(out) == n || len(buckets[d]) == 0 {
				continue
			}
			out = append(out, buckets[d][0])
			buckets[d] = buckets[d][1:]
		}
	}
	rng.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
	return out, nil
}

// selectPracticeClips picks n clips nearest the staircase level. Already-seen clips come first:
// practice reveals windows, so it should spend clips that can no longer appear in a mock.
func selectPracticeClips(candidates []ClipItem, seen map[string]bool, level, n int, rng *rand.Rand) ([]ClipItem, error) {
	pool := dedupeClips(candidates)
	if len(pool) < n {
		return nil, fmt.Errorf("%w: %d practice clips, need %d", ErrPoolTooSmall, len(pool), n)
	}
	sort.Slice(pool, func(i, j int) bool { return pool[i].Ref < pool[j].Ref })
	rng.Shuffle(len(pool), func(i, j int) { pool[i], pool[j] = pool[j], pool[i] })
	dist := func(c ClipItem) int {
		if c.CuratorDifficulty == 0 {
			return 5
		}
		return abs(c.CuratorDifficulty - level)
	}
	sort.SliceStable(pool, func(i, j int) bool {
		si, sj := seen[pool[i].ClipID], seen[pool[j].ClipID]
		if si != sj {
			return si
		}
		return dist(pool[i]) < dist(pool[j])
	})
	return pool[:n], nil
}

func dedupeClips(cs []ClipItem) []ClipItem {
	used := map[string]bool{}
	var out []ClipItem
	for _, c := range cs {
		if !used[c.ClipID] {
			used[c.ClipID] = true
			out = append(out, c)
		}
	}
	return out
}

// selectLL picks count questions from pool ("mock" or "practice"): one variant per concept,
// avoiding recently played variants when another variant of the concept exists.
func selectLL(g *CatalogGame, pool string, count int, recent map[string]bool, rng *rand.Rand) ([]CatalogItem, error) {
	byConcept := map[string][]CatalogItem{}
	var concepts []string
	for _, it := range g.Items {
		if it.Pool != pool {
			continue
		}
		c := it.ConceptID
		if c == "" {
			c = it.Ref
		}
		if _, ok := byConcept[c]; !ok {
			concepts = append(concepts, c)
		}
		byConcept[c] = append(byConcept[c], it)
	}
	if len(concepts) < count {
		return nil, fmt.Errorf("%w: %d %s concepts, need %d", ErrPoolTooSmall, len(concepts), pool, count)
	}
	sort.Strings(concepts)
	rng.Shuffle(len(concepts), func(i, j int) { concepts[i], concepts[j] = concepts[j], concepts[i] })
	// Concepts with a fresh variant first, so recent variants are only reused when unavoidable.
	fresh := func(c string) bool {
		for _, v := range byConcept[c] {
			if !recent[v.Ref] {
				return true
			}
		}
		return false
	}
	sort.SliceStable(concepts, func(i, j int) bool { return fresh(concepts[i]) && !fresh(concepts[j]) })
	out := make([]CatalogItem, 0, count)
	for _, c := range concepts[:count] {
		vs := byConcept[c]
		var pick []CatalogItem
		for _, v := range vs {
			if !recent[v.Ref] {
				pick = append(pick, v)
			}
		}
		if len(pick) == 0 {
			pick = vs
		}
		out = append(out, pick[rng.IntN(len(pick))])
	}
	return out, nil
}

// selectStoppingDistance plays every catalogue round, in catalogue order (as the golden vectors).
func selectStoppingDistance(g *CatalogGame) ([]CatalogItem, error) {
	if len(g.Items) == 0 || len(g.Items) > 40 {
		return nil, fmt.Errorf("%w: %d stopping-distance rounds", ErrPoolTooSmall, len(g.Items))
	}
	return append([]CatalogItem(nil), g.Items...), nil
}

// selectBlindSpot plays one random Part A scene, then every Part B scene (game-core blind_spot
// scores Part A and Part B separately: partAPassPoints / partBPassPoints).
func selectBlindSpot(g *CatalogGame, rng *rand.Rand) ([]CatalogItem, error) {
	var a, b []CatalogItem
	for _, it := range g.Items {
		switch {
		case strings.HasPrefix(it.Ref, "bs:part-a"):
			a = append(a, it)
		case strings.HasPrefix(it.Ref, "bs:part-b"):
			b = append(b, it)
		}
	}
	if len(a) == 0 || len(b) == 0 {
		return nil, fmt.Errorf("%w: blind spot needs a Part A and a Part B item", ErrPoolTooSmall)
	}
	return append([]CatalogItem{a[rng.IntN(len(a))]}, b...), nil
}

// clipRef parses "clip:<id>@<version>".
func clipRef(ref string) (id string, version int, ok bool) {
	body, found := strings.CutPrefix(ref, "clip:")
	if !found {
		return "", 0, false
	}
	id, v, found := strings.Cut(body, "@")
	if !found || id == "" {
		return "", 0, false
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return "", 0, false
	}
	return id, n, true
}

// itemKind is the ref's kind prefix.
func itemKind(ref string) string {
	k, _, _ := strings.Cut(ref, ":")
	return k
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
