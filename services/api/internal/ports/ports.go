// Package ports defines the hexagonal ports of the Margdarshak core (F-56, D-08, MD-036).
// Government systems (Sarathi, DigiLocker, Aadhaar offline, Bhashini, payment gateways, slot
// feeds), notifications and the job runner are reached only through these interfaces. Adapters
// translate external formats into the domain types below: nothing outside internal/adapters
// sees a government payload shape (anti-corruption layer).
//
// Every port has a shared contract suite (internal/ports/contracttest) that the mock and any
// real implementation must pass. The suite documents each method's error kinds.
package ports

import (
	"context"
	"errors"
	"fmt"
)

// ErrorKind classifies adapter failures. Callers branch on kinds, never on adapter details.
type ErrorKind string

// Error kinds every port may return (documented per method in the contract suite).
const (
	// KindTimeout: the call exceeded its deadline (default 5 s); retry later.
	KindTimeout ErrorKind = "timeout"
	// KindUnavailable: the upstream is down (EC-11 Sarathi outage); show the outage state, keep drafts.
	KindUnavailable ErrorKind = "unavailable"
	// KindInvalid: the request was rejected as malformed or failed verification (bad PKCE verifier,
	// bad signature, unknown application reference).
	KindInvalid ErrorKind = "invalid"
	// KindPending: the upstream accepted but has no final answer yet (EC-09 payment debited but pending).
	KindPending ErrorKind = "pending"
	// KindNotFound: the referenced object does not exist or consent does not cover it.
	KindNotFound ErrorKind = "not_found"
	// KindUnsupported: the operation or language is not offered by this implementation
	// (Dogri TTS, SMS before TRAI DLT, status reads in deeplink mode).
	KindUnsupported ErrorKind = "unsupported"
	// KindProhibited: the input carried data Margdarshak must never accept (Aadhaar number, OTP).
	KindProhibited ErrorKind = "prohibited"
)

// Error is the single error type adapters return.
type Error struct {
	Port string
	Op   string
	Kind ErrorKind
	Msg  string
}

func (e *Error) Error() string {
	if e.Msg == "" {
		return fmt.Sprintf("%s.%s: %s", e.Port, e.Op, e.Kind)
	}
	return fmt.Sprintf("%s.%s: %s: %s", e.Port, e.Op, e.Kind, e.Msg)
}

// Is matches on Kind so errors.Is(err, ports.ErrTimeout) works.
func (e *Error) Is(target error) bool {
	t, ok := target.(*Error)
	return ok && t.Port == "" && t.Op == "" && t.Kind == e.Kind
}

// Sentinels for errors.Is.
var (
	ErrTimeout     = &Error{Kind: KindTimeout}
	ErrUnavailable = &Error{Kind: KindUnavailable}
	ErrInvalid     = &Error{Kind: KindInvalid}
	ErrPending     = &Error{Kind: KindPending}
	ErrNotFound    = &Error{Kind: KindNotFound}
	ErrUnsupported = &Error{Kind: KindUnsupported}
	ErrProhibited  = &Error{Kind: KindProhibited}
)

// E builds an adapter error.
func E(port, op string, kind ErrorKind, msg string) error {
	return &Error{Port: port, Op: op, Kind: kind, Msg: msg}
}

// KindOf returns the kind of an adapter error, or "" for other errors. A context deadline is
// reported as a timeout.
func KindOf(err error) ErrorKind {
	var e *Error
	if errors.As(err, &e) {
		return e.Kind
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return KindTimeout
	}
	return ""
}

// Health is an adapter's self-reported status, surfaced on API-64.
type Health struct {
	Implementation string `json:"implementation"`
	Status         string `json:"status"` // ok | degraded | down
	Detail         string `json:"detail,omitempty"`
}

// Fault is an injectable failure for mocks (contract tests, demo of EC-09/EC-11).
type Fault string

// Faults mocks understand.
const (
	FaultNone           Fault = ""
	FaultOutage         Fault = "outage"
	FaultTimeout        Fault = "timeout"
	FaultPendingPayment Fault = "pending_payment"
)

// FaultInjector is implemented by mocks; real adapters do not implement it, so the contract
// suite skips fault cases for them and runs them against recorded cassettes instead.
type FaultInjector interface {
	InjectFault(Fault)
}
