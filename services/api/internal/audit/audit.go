// Package audit appends E-30 rows (MD-050, D-18): admin actions, consent changes, helper and
// family actions, adapter calls, internal-channel calls, deletions. The table is append-only
// (DB trigger + no UPDATE/DELETE grant for the app roles) and each tenant's rows form a SHA-256
// hash chain, so a removed or edited row is detectable. Timestamps come from the server clock.
package audit

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/sruj08/margadarshak/services/api/internal/ids"
	"github.com/sruj08/margadarshak/services/api/internal/privacy"
)

// Entry is one audit event. Actor is pseudonymous (usr_..., dev_..., n8n, system).
type Entry struct {
	Tenant     string
	Actor      string
	ActorScope string
	Action     string // e.g. consent.grant, family.add, internal.clock_sweep, adapter.digilocker.pull
	Target     string
	Purpose    string
	ConsentID  *uuid.UUID
	Outcome    string // ok | denied | error
	Meta       map[string]any
	IP         string
	UserAgent  string
	TraceID    string
}

// Append writes e inside tx and returns the new row id.
func Append(ctx context.Context, tx pgx.Tx, at time.Time, e Entry) (uuid.UUID, error) {
	if e.Tenant == "" || e.Action == "" {
		return uuid.Nil, errors.New("audit: tenant and action are required")
	}
	if e.Outcome == "" {
		e.Outcome = "ok"
	}
	if e.Actor == "" {
		e.Actor = "anonymous"
	}
	if e.ActorScope == "" {
		e.ActorScope = "public"
	}
	meta := redactMeta(e.Meta)
	metaJSON, _ := json.Marshal(meta)
	// Serialise appends per tenant so the chain is linear.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('audit:' || $1))`, e.Tenant); err != nil {
		return uuid.Nil, fmt.Errorf("audit: lock: %w", err)
	}
	var prev []byte
	err := tx.QueryRow(ctx, `SELECT hash FROM audit.audit_log WHERE tenant_id = $1 ORDER BY at DESC, audit_id DESC LIMIT 1`, e.Tenant).Scan(&prev)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, fmt.Errorf("audit: prev: %w", err)
	}
	id := ids.New()
	at = at.UTC().Truncate(time.Microsecond)
	var uaHash []byte
	if e.UserAgent != "" {
		s := sha256.Sum256([]byte(e.UserAgent))
		uaHash = s[:8]
	}
	row := canonical{ID: id.String(), At: at.Format(time.RFC3339Nano), Tenant: e.Tenant, Actor: e.Actor, Scope: e.ActorScope,
		Action: e.Action, Target: e.Target, Purpose: e.Purpose, Outcome: e.Outcome, Meta: string(metaJSON)}
	if e.ConsentID != nil {
		row.Consent = e.ConsentID.String()
	}
	hash := chainHash(prev, row)
	_, err = tx.Exec(ctx, `INSERT INTO audit.audit_log (audit_id, at, tenant_id, actor, actor_scope, action, target, purpose,
		consent_id, outcome, meta, ip_trunc, user_agent_hash, trace_id, prev_hash, hash)
		VALUES ($1, $2, $3, $4, $5, $6, $7, nullif($8, ''), $9, $10, $11, nullif($12, ''), $13, nullif($14, ''), $15, $16)`,
		id, at, e.Tenant, e.Actor, e.ActorScope, e.Action, e.Target, e.Purpose, e.ConsentID, e.Outcome, metaJSON,
		TruncateIP(e.IP), uaHash, e.TraceID, prev, hash)
	if err != nil {
		return uuid.Nil, fmt.Errorf("audit: insert: %w", err)
	}
	return id, nil
}

type canonical struct {
	ID      string `json:"id"`
	At      string `json:"at"`
	Tenant  string `json:"tenant"`
	Actor   string `json:"actor"`
	Scope   string `json:"scope"`
	Action  string `json:"action"`
	Target  string `json:"target"`
	Purpose string `json:"purpose"`
	Consent string `json:"consent"`
	Outcome string `json:"outcome"`
	Meta    string `json:"meta"`
}

func chainHash(prev []byte, row canonical) []byte {
	b, _ := json.Marshal(row)
	h := sha256.New()
	h.Write(prev)
	h.Write(b)
	return h.Sum(nil)
}

// VerifyChain recomputes the tenant's hash chain and reports the first broken row.
func VerifyChain(ctx context.Context, tx pgx.Tx, tenant string) (int, error) {
	rows, err := tx.Query(ctx, `SELECT audit_id, at, tenant_id, actor, actor_scope, action, target, coalesce(purpose, ''),
		consent_id, outcome, meta::text, prev_hash, hash FROM audit.audit_log WHERE tenant_id = $1 ORDER BY at, audit_id`, tenant)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var prev []byte
	n := 0
	for rows.Next() {
		var id uuid.UUID
		var at time.Time
		var consent *uuid.UUID
		var c canonical
		var prevHash, hash []byte
		var meta string
		if err := rows.Scan(&id, &at, &c.Tenant, &c.Actor, &c.Scope, &c.Action, &c.Target, &c.Purpose, &consent, &c.Outcome, &meta, &prevHash, &hash); err != nil {
			return n, err
		}
		c.ID, c.At = id.String(), at.UTC().Format(time.RFC3339Nano)
		if consent != nil {
			c.Consent = consent.String()
		}
		// Re-marshal the stored jsonb so key order matches the canonical form used at append.
		var m map[string]any
		_ = json.Unmarshal([]byte(meta), &m)
		mb, _ := json.Marshal(orEmpty(m))
		c.Meta = string(mb)
		if !bytes.Equal(prevHash, prev) || !bytes.Equal(chainHash(prev, c), hash) {
			return n, fmt.Errorf("audit: chain broken at row %d (%s)", n+1, id)
		}
		prev = hash
		n++
	}
	return n, rows.Err()
}

func orEmpty(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func redactMeta(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		switch t := v.(type) {
		case string:
			out[k] = privacy.RedactString(t)
		case map[string]any:
			out[k] = redactMeta(t)
		default:
			s := fmt.Sprint(t)
			if _, ok := privacy.FirstProhibited(s); ok {
				out[k] = privacy.RedactString(s)
			} else {
				out[k] = t
			}
		}
	}
	return out
}

// TruncateIP keeps /24 of IPv4 and /48 of IPv6 (DATA_MODEL §4.10).
func TruncateIP(ip string) string {
	host, _, err := net.SplitHostPort(ip)
	if err != nil {
		host = ip
	}
	parsed := net.ParseIP(host)
	if parsed == nil {
		return ""
	}
	if v4 := parsed.To4(); v4 != nil {
		return fmt.Sprintf("%d.%d.%d.0/24", v4[0], v4[1], v4[2])
	}
	return parsed.Mask(net.CIDRMask(48, 128)).String() + "/48"
}

// ActorID renders a pseudonymous actor id.
func ActorID(prefix string, id uuid.UUID) string { return ids.Encode(prefix, id) }
