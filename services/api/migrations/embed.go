// Package migrations embeds the goose SQL migrations (expand -> migrate -> contract; one linear
// history). Run them with `go run ./cmd/seed -migrate-only` or on API start (MIGRATE_ON_START).
package migrations

import "embed"

// FS holds every *.sql migration.
//
//go:embed *.sql
var FS embed.FS
