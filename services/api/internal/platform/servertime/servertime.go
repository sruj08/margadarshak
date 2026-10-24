// Package servertime is the single source of "now" for the API. Server time in IST
// (Asia/Kolkata) is the source of truth for every date the product shows (EC-15): device
// clocks are never trusted.
package servertime

import (
	"sync"
	"time"
)

// IST is the Asia/Kolkata location. India has no DST, so a fixed +05:30 zone is used when the
// tz database is missing (common on minimal containers and Windows without tzdata).
var IST = loadIST()

func loadIST() *time.Location {
	if loc, err := time.LoadLocation("Asia/Kolkata"); err == nil {
		return loc
	}
	return time.FixedZone("IST", 5*3600+30*60)
}

// Clock returns the current server time.
type Clock interface {
	Now() time.Time
}

// System is the host clock (NTP-synced in production, CERT-In).
type System struct{}

// Now returns the current UTC time.
func (System) Now() time.Time { return time.Now().UTC() }

// Offset is the host clock shifted by a fixed duration (DEV_CLOCK_OFFSET, dev/test only).
type Offset struct{ By time.Duration }

// Now returns the shifted current UTC time.
func (o Offset) Now() time.Time { return time.Now().UTC().Add(o.By) }

// Fixed is a settable clock for tests and seeds.
type Fixed struct {
	mu sync.Mutex
	t  time.Time
}

// NewFixed returns a clock frozen at t.
func NewFixed(t time.Time) *Fixed { return &Fixed{t: t.UTC()} }

// Now returns the frozen time.
func (f *Fixed) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.t
}

// Advance moves the clock forward.
func (f *Fixed) Advance(d time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.t = f.t.Add(d)
}

// Set moves the clock to t.
func (f *Fixed) Set(t time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.t = t.UTC()
}

// TodayIST returns the IST calendar date of t at 00:00 IST.
func TodayIST(t time.Time) time.Time {
	in := t.In(IST)
	return time.Date(in.Year(), in.Month(), in.Day(), 0, 0, 0, 0, IST)
}

// DateIST formats t as an ISO 8601 calendar date in the IST calendar.
func DateIST(t time.Time) string { return t.In(IST).Format(time.DateOnly) }
