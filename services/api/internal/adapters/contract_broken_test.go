//go:build brokenmock

// This file exists to prove the contract job fails when an adapter breaks its contract.
// Run: go test -tags brokenmock ./internal/adapters/ -run TestContractBroken   (expected: FAIL)
package adapters_test

import (
	"context"
	"testing"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/slot"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/ports/contracttest"
)

// brokenSlot drops the "simulated" label and is not deterministic: two contract violations.
type brokenSlot struct {
	*slot.Mock
	calls int
}

func (b *brokenSlot) ListSlots(ctx context.Context, office, kind string, from, to time.Time) ([]ports.Slot, error) {
	out, err := b.Mock.ListSlots(ctx, office, kind, from, to)
	b.calls++
	for i := range out {
		out[i].Simulated = false
		out[i].Window = time.Duration(b.calls).String()
	}
	return out, err
}

func TestContractBrokenSlotMock(t *testing.T) {
	shared := &brokenSlot{Mock: slot.NewMock(42)}
	contracttest.Slot(t, func(*testing.T) ports.SlotPort { return shared }, true)
}
