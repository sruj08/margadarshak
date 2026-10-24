// Package slot is the mock SlotPort (MD-043, F-10, D-08): synthetic J&K offices with seeded,
// deterministic slot calendars. Same seed, same calendar. Every slot carries Simulated=true and
// every office SampleData=true. It is read-only: there is no booking method, because booking
// stays on Sarathi and Margdarshak never scrapes or holds slots.
package slot

import (
	"context"
	"encoding/base32"
	"encoding/binary"
	"hash/fnv"
	"strings"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

const port = "slot"

// Offices are synthetic J&K offices (town names and public RTO codes only; sample data).
var Offices = []ports.Office{
	{ID: "off_jk02", Kind: "rto", Code: "JK02", Name: "RTO Jammu", District: "Jammu", State: "JK", Lat: 32.73, Lng: 74.86,
		Tracks: []string{"eight_track", "s_track"}, TestMode: "manual", SampleData: true},
	{ID: "off_jk08", Kind: "arto", Code: "JK08", Name: "ARTO Kathua", District: "Kathua", State: "JK", Lat: 32.37, Lng: 75.52,
		Tracks: []string{"eight_track"}, TestMode: "manual", SampleData: true},
	{ID: "off_jk14", Kind: "arto", Code: "JK14", Name: "ARTO Udhampur", District: "Udhampur", State: "JK", Lat: 32.92, Lng: 75.14,
		Tracks: []string{"eight_track", "gradient"}, TestMode: "manual", SampleData: true},
	{ID: "off_jk_adtc_jammu", Kind: "adtc", Code: "ADTC-JMU", Name: "Accredited Driver Training Centre, Jammu (sample)", District: "Jammu", State: "JK",
		Lat: 32.70, Lng: 74.87, Tracks: []string{"eight_track", "h_track", "reverse_park"}, TestMode: "automated", SampleData: true},
	{ID: "off_jk_csc_gandhinagar", Kind: "csc", Code: "CSC-JMU-01", Name: "Common Service Centre, Gandhi Nagar (sample)", District: "Jammu", State: "JK",
		Lat: 32.71, Lng: 74.86, TestMode: "unknown", SampleData: true},
}

// Mock serves the seeded calendar.
type Mock struct {
	Seed  uint64
	fault ports.Fault
}

// NewMock returns a calendar for seed.
func NewMock(seed uint64) *Mock { return &Mock{Seed: seed} }

// Mode implements ports.SlotPort.
func (m *Mock) Mode() string { return "mock" }

// InjectFault implements ports.FaultInjector.
func (m *Mock) InjectFault(f ports.Fault) { m.fault = f }

// ListOffices implements ports.SlotPort.
func (m *Mock) ListOffices(_ context.Context, state, kind string) ([]ports.Office, error) {
	if m.fault == ports.FaultOutage {
		return nil, ports.E(port, "ListOffices", ports.KindUnavailable, "simulated outage")
	}
	var out []ports.Office
	for _, o := range Offices {
		if (state == "" || strings.EqualFold(state, o.State)) && (kind == "" || kind == o.Kind) {
			out = append(out, o)
		}
	}
	return out, nil
}

var windows = []string{"10:00-13:00", "14:00-17:00"}
var bands = []string{"none", "few", "some", "many"}

// ListSlots implements ports.SlotPort. Sundays are closed; CSCs hold no test slots.
func (m *Mock) ListSlots(_ context.Context, officeID, kind string, from, to time.Time) ([]ports.Slot, error) {
	if m.fault == ports.FaultOutage {
		return nil, ports.E(port, "ListSlots", ports.KindUnavailable, "simulated outage")
	}
	var office *ports.Office
	for i := range Offices {
		if Offices[i].ID == officeID {
			office = &Offices[i]
		}
	}
	if office == nil {
		return nil, ports.E(port, "ListSlots", ports.KindNotFound, "office "+officeID)
	}
	if kind != "ll_test" && kind != "dl_test" {
		return nil, ports.E(port, "ListSlots", ports.KindInvalid, "kind must be ll_test or dl_test")
	}
	from, to = servertime.TodayIST(from), servertime.TodayIST(to)
	if to.Before(from) || to.Sub(from) > 31*24*time.Hour {
		return nil, ports.E(port, "ListSlots", ports.KindInvalid, "range must be 0-31 days")
	}
	if office.Kind == "csc" {
		return []ports.Slot{}, nil
	}
	out := []ports.Slot{}
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		if d.Weekday() == time.Sunday {
			continue
		}
		for wi, w := range windows {
			h := m.hash(officeID, kind, d, wi)
			out = append(out, ports.Slot{
				ID:           "slt_" + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(binaryBE(h))),
				OfficeID:     officeID,
				Kind:         kind,
				Date:         d,
				Window:       w,
				CapacityBand: bands[h%uint64(len(bands))],
				Source:       "mock",
				Simulated:    true,
			})
		}
	}
	return out, nil
}

func (m *Mock) hash(office, kind string, d time.Time, window int) uint64 {
	h := fnv.New64a()
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], m.Seed)
	h.Write(b[:])
	h.Write([]byte(office + "|" + kind + "|" + d.Format(time.DateOnly) + "|"))
	h.Write([]byte{byte(window)})
	return h.Sum64()
}

func binaryBE(v uint64) []byte {
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], v)
	return b[:]
}

// Health implements ports.SlotPort.
func (m *Mock) Health(context.Context) ports.Health {
	if m.fault == ports.FaultOutage {
		return ports.Health{Implementation: "mock", Status: "down"}
	}
	return ports.Health{Implementation: "mock", Status: "ok"}
}
