package games_test

import (
	"testing"

	"github.com/sruj08/margadarshak/services/api/internal/games/gamestest"
)

// The in-memory store passes the same contract as the pgx store (internal/store/games_test.go).
func TestMemStoreContract(t *testing.T) {
	gamestest.RunStoreContract(t, gamestest.MemFixture)
}
