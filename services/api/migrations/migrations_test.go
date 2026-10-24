package migrations_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/sruj08/margadarshak/services/api/internal/store"
	"github.com/sruj08/margadarshak/services/api/internal/testdb"
)

func TestMain(m *testing.M) { os.Exit(testdb.Main(m)) }

// TestMigrationsUpDownUp proves every migration is reversible (CI: migrations job).
func TestMigrationsUpDownUp(t *testing.T) {
	dsn := testdb.Empty(t)
	ctx := context.Background()
	steps := []string{"up", "down", "up", "reset", "up"}
	for _, s := range steps {
		if _, err := store.Migrate(ctx, dsn, s); err != nil {
			t.Fatalf("migrate %s: %v", s, err)
		}
	}
	status, err := store.Migrate(ctx, dsn, "status")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(status, "pending") {
		t.Fatalf("pending migrations after up:\n%s", status)
	}
}
