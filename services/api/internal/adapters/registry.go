// Package adapters is the composition point for outbound adapters (F-56, MD-036). Adapter choice
// is per tenant (core.tenant_adapter_config: mock | deeplink | real ...) with optional ADAPTER_*
// environment overrides, so a state flips modes with a config change only. Adapters never
// import each other; they meet here.
package adapters

import (
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/aadhaaroffline"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/bhashini"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/digilocker"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/payment"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/sarathi"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/mock/slot"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/notify"
	"github.com/sruj08/margadarshak/services/api/internal/platform/hmacsig"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
)

// Port names (match core.tenant_adapter_config.port).
const (
	PortSarathi        = "sarathi"
	PortDigiLocker     = "digilocker"
	PortAadhaarOffline = "aadhaar_offline"
	PortBhashini       = "bhashini"
	PortPayment        = "payment"
	PortNotification   = "notification"
	PortSlot           = "slot"
)

// Implementations lists what this build provides per port. Real government adapters (nic,
// negd, state_gateway, dhruva, ...) plug in here after a state adopts and they pass the contract
// suite (INTEGRATIONS §5).
var Implementations = map[string][]string{
	PortSarathi:        {"deeplink", "mock"},
	PortDigiLocker:     {"mock"},
	PortAadhaarOffline: {"disabled", "mock"},
	PortBhashini:       {"mock"},
	PortPayment:        {"mock", "sarathi_redirect"},
	PortNotification:   {"console", "n8n"},
	PortSlot:           {"mock"},
}

// Set is the adapter set for one tenant.
type Set struct {
	Sarathi        ports.SarathiPort
	DigiLocker     ports.DigiLockerPort
	AadhaarOffline ports.AadhaarOfflinePort
	Bhashini       ports.BhashiniPort
	Payment        ports.PaymentPort
	Notification   ports.NotificationPort
	Slot           ports.SlotPort
	// Modes is port -> implementation actually selected.
	Modes map[string]string
}

// Deps are what adapters need from the platform.
type Deps struct {
	Now           func() time.Time
	PublicBaseURL string
	PaymentSecret []byte
	AadhaarKey    []byte
	Replay        hmacsig.ReplayCache
	Log           *slog.Logger
	// Email sends the e-mail channel (SMTP when configured, else console).
	Email    ports.NotificationPort
	SlotSeed uint64
	// Overrides are ADAPTER_* environment overrides (port -> implementation).
	Overrides map[string]string
}

// Registry builds adapters and keeps one instance per (port, implementation), so stateful mocks
// (DigiLocker grants, Sarathi applications) survive across requests.
type Registry struct {
	deps Deps
	mu   sync.Mutex
	inst map[string]any
}

// NewRegistry returns a registry.
func NewRegistry(d Deps) *Registry {
	if d.Now == nil {
		d.Now = func() time.Time { return time.Now().UTC() }
	}
	if d.Log == nil {
		d.Log = slog.New(slog.DiscardHandler)
	}
	if d.Email == nil {
		d.Email = notify.Console{Log: d.Log}
	}
	if d.Replay == nil {
		d.Replay = hmacsig.NewMemoryReplayCache()
	}
	return &Registry{deps: d, inst: map[string]any{}}
}

// For returns the adapter set for a tenant configuration (port -> implementation).
func (r *Registry) For(config map[string]string) (Set, error) {
	modes := map[string]string{}
	for p := range Implementations {
		impl := config[p]
		if o := r.deps.Overrides[p]; o != "" {
			impl = o
		}
		if impl == "" {
			impl = Implementations[p][0]
		}
		modes[p] = impl
	}
	var s Set
	var err error
	get := func(p string) any {
		if err != nil {
			return nil
		}
		var v any
		v, err = r.Get(p, modes[p])
		return v
	}
	s.Sarathi, _ = get(PortSarathi).(ports.SarathiPort)
	s.DigiLocker, _ = get(PortDigiLocker).(ports.DigiLockerPort)
	s.AadhaarOffline, _ = get(PortAadhaarOffline).(ports.AadhaarOfflinePort)
	s.Bhashini, _ = get(PortBhashini).(ports.BhashiniPort)
	s.Payment, _ = get(PortPayment).(ports.PaymentPort)
	s.Notification, _ = get(PortNotification).(ports.NotificationPort)
	s.Slot, _ = get(PortSlot).(ports.SlotPort)
	s.Modes = modes
	return s, err
}

// Get returns the singleton implementation of a port.
func (r *Registry) Get(port, impl string) (any, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := port + "/" + impl
	if v, ok := r.inst[key]; ok {
		return v, nil
	}
	v, err := r.build(port, impl)
	if err != nil {
		return nil, err
	}
	r.inst[key] = v
	return v, nil
}

func (r *Registry) build(port, impl string) (any, error) {
	d := r.deps
	base := strings.TrimRight(d.PublicBaseURL, "/")
	switch port + "/" + impl {
	case "sarathi/deeplink":
		return sarathi.NewDeeplink(d.Now), nil
	case "sarathi/mock":
		return sarathi.NewMock(d.Now), nil
	case "digilocker/mock":
		return digilocker.NewMock(base+"/mock/digilocker/authorize", d.Now), nil
	case "aadhaar_offline/mock":
		return aadhaaroffline.NewMock(d.AadhaarKey, d.Now, d.Log), nil
	case "aadhaar_offline/disabled":
		return aadhaaroffline.Disabled{}, nil
	case "bhashini/mock":
		return bhashini.NewMock(), nil
	case "payment/mock":
		return payment.NewMock(base+"/mock/payment", d.PaymentSecret, d.Replay, d.Now), nil
	case "payment/sarathi_redirect":
		return payment.SarathiRedirect{}, nil
	case "notification/console":
		router := notify.NewRouter(notify.Console{Log: d.Log}, d.Log)
		return router, nil
	case "notification/n8n":
		return notify.NewRouter(d.Email, d.Log), nil
	case "slot/mock":
		return slot.NewMock(d.SlotSeed), nil
	}
	known := append([]string(nil), Implementations[port]...)
	sort.Strings(known)
	return nil, fmt.Errorf("adapters: %s implementation %q is not available in this build (have: %s)", port, impl, strings.Join(known, ", "))
}

// DigiLockerMock returns the simulated DigiLocker (for the simulated consent page).
func (r *Registry) DigiLockerMock() *digilocker.Mock {
	v, _ := r.Get(PortDigiLocker, "mock")
	m, _ := v.(*digilocker.Mock)
	return m
}

// PaymentMock returns the fake payment gateway (for the fake payment page).
func (r *Registry) PaymentMock() *payment.Mock {
	v, _ := r.Get(PortPayment, "mock")
	m, _ := v.(*payment.Mock)
	return m
}

// SarathiMock returns the Sarathi simulator.
func (r *Registry) SarathiMock() *sarathi.Mock {
	v, _ := r.Get(PortSarathi, "mock")
	m, _ := v.(*sarathi.Mock)
	return m
}
