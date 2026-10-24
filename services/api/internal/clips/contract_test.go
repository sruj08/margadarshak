package clips_test

import (
	"testing"

	"github.com/sruj08/margadarshak/services/api/internal/clips"
	"github.com/sruj08/margadarshak/services/api/internal/clips/clipstest"
)

func TestMemStoreContract(t *testing.T) {
	clipstest.RunStoreContract(t, func(*testing.T) clipstest.Fixture {
		return clipstest.Fixture{Store: clips.NewMemStore(), ConsentID: "8f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f"}
	})
}
