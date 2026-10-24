package games

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

func TestItemPassesPerGame(t *testing.T) {
	pattern, hidden := "pattern", "INT_TAB_HIDDEN"
	hz := []ports.HazardAnalysis{{HazardID: "h1", HazardType: "bus_stop_pedestrian"}}
	nazar := map[string]ports.NazarAnalysis{ports.AnalysisNazarClips: {Rule: "kerala_5band", Clips: []ports.ClipAnalysis{
		{Ordinal: 1, Marks: 10, Hazards: hz},
		{Ordinal: 2, Marks: 6, Hazards: hz},
		{Ordinal: 3, Marks: 5, Hazards: hz},
		{Ordinal: 4, Marks: 0, Hazards: []ports.HazardAnalysis{}}, // quiet clip: not an item
		{Ordinal: 5, Marks: 8, Hazards: hz, Voided: &pattern},     // pattern-clicking: a fail
		{Ordinal: 6, Marks: 0, Hazards: hz, Voided: &hidden},      // device void: skipped
	}}}
	for _, c := range []struct {
		name, game, result string
		analysis           map[string]ports.NazarAnalysis
		want               []bool
	}{
		{"nazar marks >= 6", GameNazar, `{}`, nazar, []bool{true, true, false, false}},
		{"nazar without analysis", GameNazar, `{}`, nil, nil},
		{"ll_sim correct and not 50%", GameLLSim, `{"evidence":[{"correct":true,"confidence":"75"},{"correct":true,"confidence":"50"},` +
			`{"correct":false},{"correct":true}]}`, nil, []bool{true, false, false, true}},
		{"stopping distance 80%", GameStoppingDistance, `{"score":{"raw":80,"max":100}}`, nil, []bool{true}},
		{"stopping distance below", GameStoppingDistance, `{"score":{"raw":79.9,"max":100}}`, nil, []bool{false}},
		{"blind spot A and B", GameBlindSpot, `{"components":[{"id":"placement","value":24,"max":30},{"id":"no_zone_time","value":30,"max":30},` +
			`{"id":"mirror_checks","value":15,"max":15},{"id":"hold_back","value":12,"max":25}],"findings":[]}`, nil, []bool{true, true}},
		{"blind spot critical fails B", GameBlindSpot, `{"components":[{"id":"placement","value":20,"max":30},{"id":"no_zone_time","value":30,"max":30},` +
			`{"id":"mirror_checks","value":15,"max":15},{"id":"hold_back","value":25,"max":25}],"findings":[{"critical":true}]}`, nil, []bool{false, false}},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := ItemPasses(c.game, json.RawMessage(c.result), c.analysis); !reflect.DeepEqual(got, c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

// GAME_SDK §7: a verified practice session moves the staircase (2 passes up, 1 fail down); a mock
// never does; the next practice session starts at the new level.
func TestStaircaseAdaptsAfterVerifiedPracticeOnly(t *testing.T) {
	e := newEnv(t, bank(60))
	stairs := NewMemStaircase()
	e.svc.Staircase = stairs
	level := func() int {
		l, err := stairs.Level(context.Background(), nil, e.subj, GameStoppingDistance, GameStoppingDistance)
		if err != nil {
			t.Fatal(err)
		}
		return l
	}
	play := func(mode string, pct float64, digest string) {
		e.compute.set(func(f *fakeCompute) { f.pct = pct })
		st := e.start(t, GameStoppingDistance, mode)
		e.complete(t, st.Session.ID, "", replay(digest))
	}
	play(ModePractice, 90, "a")
	if level() != 1 {
		t.Fatalf("one pass keeps level 1, got %d", level())
	}
	play(ModePractice, 85, "b")
	if level() != 2 {
		t.Fatalf("two passes step up to 2, got %d", level())
	}
	if st := e.start(t, GameStoppingDistance, ModePractice); st.Context.Difficulty != 2 {
		t.Fatalf("the next practice starts at level 2, got %d", st.Context.Difficulty)
	}
	play(ModePractice, 40, "c")
	if level() != 1 {
		t.Fatalf("a fail steps down to 1, got %d", level())
	}

	// Nazar mocks never adapt; a provisional (unverified) practice does not either.
	e.compute.set(func(f *fakeCompute) { f.pct = 100 })
	for i, d := range []string{"d", "e"} {
		st := e.start(t, GameNazar, ModeMock)
		e.complete(t, st.Session.ID, "", replay(d))
		if l, _ := stairs.Level(context.Background(), nil, e.subj, GameNazar, GameNazar); l != 1 {
			t.Fatalf("mock %d moved the staircase to %d", i, l)
		}
	}
	e.compute.set(func(f *fakeCompute) { f.err = ports.ErrComputeUnavailable })
	st := e.start(t, GameStoppingDistance, ModePractice)
	if out := e.complete(t, st.Session.ID, "", replay("f")); !out.Provisional {
		t.Fatal("expected a provisional session")
	}
	if level() != 1 {
		t.Fatalf("a provisional session moved the staircase to %d", level())
	}
}
