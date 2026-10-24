package ports

import (
	"context"
	"encoding/json"
	"time"
)

// ---- Notifications (F-53, E-13, D-16) -------------------------------------------------------

// Message is one outbound notification. To is the decrypted contact value; it is held in memory
// only for the send and never logged or stored in E-13.
type Message struct {
	IdempotencyKey string
	Channel        string // email | whatsapp | web_push | sms | in_app
	TemplateID     string
	Language       string
	To             string
	Vars           map[string]string
}

// Delivery states written to E-13.
const (
	DeliveryQueued           = "queued"
	DeliverySent             = "sent"
	DeliveryDelivered        = "delivered"
	DeliveryFailed           = "failed"
	DeliveryOptedOut         = "suppressed_opt_out"
	DeliveryDisabledUntilDLT = "disabled_until_dlt"
)

// DeliveryResult is the adapter's answer to Send.
type DeliveryResult struct {
	Status            string
	Provider          string
	ProviderMessageID string
}

// NotificationPort sends messages (console | smtp | n8n | webpush | sms).
type NotificationPort interface {
	Name() string
	// Send errors: unsupported (channel not handled; SMS before TRAI DLT returns status
	// disabled_until_dlt with this kind), unavailable, timeout.
	Send(ctx context.Context, m Message) (DeliveryResult, error)
}

// ---- Jobs (MD-052, D-15) ---------------------------------------------------------------------

// RunRef identifies a started run.
type RunRef struct {
	RunID         string
	Runner        string // inline | render_workflows | temporal
	ExternalRunID string
}

// RunStatus is a run's state.
type RunStatus struct {
	RunRef
	Status   string // started | running | succeeded | failed | cancelled
	Attempts int
	Result   json.RawMessage
	Error    string
}

// Terminal reports whether the run has finished.
func (s RunStatus) Terminal() bool {
	return s.Status == "succeeded" || s.Status == "failed" || s.Status == "cancelled"
}

// RetryPolicy mirrors the Render Workflows retry options (max retries, wait, backoff).
type RetryPolicy struct {
	MaxRetries     int
	Wait           time.Duration
	BackoffScaling float64
}

// DefaultRetry is 3 retries, 1 s wait, x2 backoff (BACKEND §8.1).
var DefaultRetry = RetryPolicy{MaxRetries: 3, Wait: time.Second, BackoffScaling: 2}

// JobRunner starts durable tasks: Render Workflows (hackathon), Temporal (production, design
// only) or inline (dev, CI, degraded demo mode). The same task code runs under every runner.
type JobRunner interface {
	Name() string
	// Start is idempotent by idemKey: a repeat returns the original run.
	Start(ctx context.Context, task string, args []any, idemKey string) (RunRef, error)
	Get(ctx context.Context, runID string) (RunStatus, error)
	// Await blocks until the run is terminal or ctx ends.
	Await(ctx context.Context, runID string) (RunStatus, error)
}

// ---- Rules (owned by the RULES agent; internal/rules plugs in here) -------------------------

// RulePackRef names the rule pack version in force for a tenant.
type RulePackRef struct {
	PackID      string
	Version     string
	BaseVersion string
}

// RulesPort is the narrow seam the platform needs from the rules engine: which pack is loaded
// for a state (health, tenant endpoint, case pinning). The RULES agent's engine implements it;
// until then the tenant row's rule_pack_* columns are used.
type RulesPort interface {
	PackFor(ctx context.Context, state string) (RulePackRef, error)
}
