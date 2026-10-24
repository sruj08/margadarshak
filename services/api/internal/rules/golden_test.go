package rules

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// Golden suite (MD-034). Every tests/golden/*.json file holds
// {"cases":[{"id","description","refs","input","expect"|"expect_error"}]}.
// `expect` is matched as a subset (see matchSubset); the full output is also
// compared byte-for-byte (canonical JSON) with tests/golden/snapshots/<file>,
// which the TS mirror checks too: that is the Go/TS parity proof.
//
//	go test ./internal/rules/ -run TestGolden -update   # rewrite snapshots after a reviewed rule change
//	GOLDEN_OUT=/tmp/go-golden.json go test ./internal/rules/ -run TestGolden   # dump all outputs for CI diff

var update = flag.Bool("update", false, "rewrite tests/golden/snapshots from the Go engine")

func repoRoot(t testing.TB) string {
	t.Helper()
	if r := os.Getenv("MARGDARSHAK_ROOT"); r != "" {
		return r
	}
	root, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	return root
}

var (
	libOnce sync.Once
	libVal  *Library
	libErr  error
)

func loadLib(t testing.TB) *Library {
	t.Helper()
	libOnce.Do(func() { libVal, libErr = LoadDir(filepath.Join(repoRoot(t), "rulepacks")) })
	if libErr != nil {
		t.Fatalf("load rulepacks: %v", libErr)
	}
	return libVal
}

type goldenCase struct {
	ID          string          `json:"id"`
	Description string          `json:"description"`
	Refs        []string        `json:"refs"`
	Input       json.RawMessage `json:"input"`
	Expect      json.RawMessage `json:"expect"`
	ExpectError *InputError     `json:"expect_error"`
}

type goldenFile struct {
	Cases []goldenCase `json:"cases"`
}

func goldenFiles(t *testing.T) []string {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(repoRoot(t), "tests", "golden", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(files)
	return files
}

// runCase returns the generic (canonical-decoded) output of one case.
func runCase(lib *Library, raw json.RawMessage) (any, error) {
	var in Input
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, err
	}
	plan, err := lib.Plan(in)
	if err != nil {
		var ie *InputError
		if errors.As(err, &ie) {
			return toGeneric(map[string]any{"error": map[string]any{"code": ie.Code, "field": ie.Field}})
		}
		return nil, err
	}
	return toGeneric(plan)
}

func decodeGeneric(raw []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	err := dec.Decode(&v)
	return v, err
}

func TestGoldenCases(t *testing.T) {
	lib := loadLib(t)
	all := map[string]any{}
	ids := map[string]string{}
	total := 0
	for _, file := range goldenFiles(t) {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var gf goldenFile
		if err := json.Unmarshal(raw, &gf); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		base := filepath.Base(file)
		snapPath := filepath.Join(filepath.Dir(file), "snapshots", base)
		snaps := map[string]any{}
		if !*update {
			if sraw, err := os.ReadFile(snapPath); err == nil {
				v, err := decodeGeneric(sraw)
				if err != nil {
					t.Fatalf("%s: %v", snapPath, err)
				}
				snaps, _ = v.(map[string]any)
			}
		}
		outs := map[string]any{}
		for _, gc := range gf.Cases {
			gc := gc
			total++
			if prev, dup := ids[gc.ID]; dup {
				t.Errorf("duplicate golden id %s (%s and %s)", gc.ID, prev, base)
			}
			ids[gc.ID] = base
			t.Run(gc.ID, func(t *testing.T) {
				out, err := runCase(lib, gc.Input)
				if err != nil {
					t.Fatalf("engine error: %v", err)
				}
				outs[gc.ID] = out
				all[gc.ID] = out
				if gc.ExpectError != nil {
					want, _ := toGeneric(map[string]any{"error": map[string]any{"code": gc.ExpectError.Code, "field": gc.ExpectError.Field}})
					for _, m := range matchSubset(want, out, "$") {
						t.Error(m)
					}
				} else {
					if len(gc.Expect) == 0 {
						t.Fatal("case has neither expect nor expect_error")
					}
					exp, err := decodeGeneric(gc.Expect)
					if err != nil {
						t.Fatal(err)
					}
					for _, m := range matchSubset(exp, out, "$") {
						t.Error(m)
					}
				}
				if *update {
					return
				}
				snap, ok := snaps[gc.ID]
				if !ok {
					t.Fatalf("no snapshot for %s in %s (run with -update after review)", gc.ID, snapPath)
				}
				a, _ := CanonicalJSON(out)
				b, _ := CanonicalJSON(snap)
				if !bytes.Equal(a, b) {
					t.Errorf("output differs from snapshot %s:\n got  %s\n want %s", snapPath, a, b)
				}
			})
		}
		if *update {
			b, err := marshalIndentSorted(outs)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Dir(snapPath), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(snapPath, b, 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	if total < 80 {
		t.Errorf("golden suite has %d cases, need >= 80 (MD-034)", total)
	}
	if p := os.Getenv("GOLDEN_OUT"); p != "" {
		b, err := marshalIndentSorted(all)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, b, 0o644); err != nil {
			t.Fatalf("GOLDEN_OUT: %v", err)
		}
	}
	t.Logf("golden cases: %d", total)
}

// TestGoldenECCoverage checks that every EC the rules engine owns has a case.
func TestGoldenECCoverage(t *testing.T) {
	owned := []string{"EC-01", "EC-02", "EC-03", "EC-04", "EC-05", "EC-06", "EC-07", "EC-10", "EC-12", "EC-13", "EC-21", "EC-22", "EC-28"}
	seen := map[string]bool{}
	for _, file := range goldenFiles(t) {
		raw, _ := os.ReadFile(file)
		var gf goldenFile
		if err := json.Unmarshal(raw, &gf); err != nil {
			t.Fatal(err)
		}
		for _, gc := range gf.Cases {
			for _, r := range gc.Refs {
				seen[r] = true
			}
		}
	}
	for _, ec := range owned {
		if !seen[ec] {
			t.Errorf("no golden case references %s", ec)
		}
	}
}

func marshalIndentSorted(v any) ([]byte, error) {
	g, err := toGeneric(v)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(g); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// matchSubset compares expected ⊆ actual. Objects: every expected key must
// match. Arrays: same length, element-wise. Special objects:
// {"$includes":[...]} each item matches some element; {"$excludes":[...]} no
// item matches any element; {"$len":n} exact length. The TS runner implements
// the same matcher.
func matchSubset(exp, act any, path string) []string {
	switch e := exp.(type) {
	case map[string]any:
		if _, ok := e["$includes"]; ok || hasKey(e, "$excludes") || hasKey(e, "$len") {
			arr, ok := act.([]any)
			if !ok {
				return []string{fmt.Sprintf("%s: expected an array, got %s", path, show(act))}
			}
			var out []string
			if inc, ok := e["$includes"].([]any); ok {
				for i, item := range inc {
					found := false
					for _, a := range arr {
						if len(matchSubset(item, a, path)) == 0 {
							found = true
							break
						}
					}
					if !found {
						out = append(out, fmt.Sprintf("%s: $includes[%d] %s not found in %s", path, i, show(item), show(act)))
					}
				}
			}
			if exc, ok := e["$excludes"].([]any); ok {
				for i, item := range exc {
					for _, a := range arr {
						if len(matchSubset(item, a, path)) == 0 {
							out = append(out, fmt.Sprintf("%s: $excludes[%d] %s found", path, i, show(item)))
							break
						}
					}
				}
			}
			if n, ok := e["$len"]; ok {
				want, _ := strconv.Atoi(fmt.Sprint(n))
				if len(arr) != want {
					out = append(out, fmt.Sprintf("%s: length %d, want %d", path, len(arr), want))
				}
			}
			return out
		}
		a, ok := act.(map[string]any)
		if !ok {
			return []string{fmt.Sprintf("%s: expected an object, got %s", path, show(act))}
		}
		keys := make([]string, 0, len(e))
		for k := range e {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var out []string
		for _, k := range keys {
			av, ok := a[k]
			if !ok {
				out = append(out, fmt.Sprintf("%s.%s: missing", path, k))
				continue
			}
			out = append(out, matchSubset(e[k], av, path+"."+k)...)
		}
		return out
	case []any:
		a, ok := act.([]any)
		if !ok {
			return []string{fmt.Sprintf("%s: expected an array, got %s", path, show(act))}
		}
		if len(a) != len(e) {
			return []string{fmt.Sprintf("%s: length %d, want %d (got %s)", path, len(a), len(e), show(act))}
		}
		var out []string
		for i := range e {
			out = append(out, matchSubset(e[i], a[i], fmt.Sprintf("%s[%d]", path, i))...)
		}
		return out
	default:
		ae, _ := CanonicalJSON(exp)
		aa, _ := CanonicalJSON(act)
		if !bytes.Equal(ae, aa) {
			return []string{fmt.Sprintf("%s: got %s, want %s", path, aa, ae)}
		}
		return nil
	}
}

func hasKey(m map[string]any, k string) bool { _, ok := m[k]; return ok }

func show(v any) string {
	b, err := CanonicalJSON(v)
	if err != nil {
		return fmt.Sprint(v)
	}
	s := string(b)
	if len(s) > 400 {
		s = s[:400] + "..."
	}
	return strings.TrimSpace(s)
}
