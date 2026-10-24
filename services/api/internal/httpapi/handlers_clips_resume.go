package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/sruj08/margadarshak/services/api/internal/clips"
)

// clipsResumeW08 resumes the W08 Wait node after a rater saved (n8n README: our page never sees
// $execution.resumeUrl; the backend POSTs {stage, rater_id, decision, windows_hash} to it with
// X-MD-Resume-Token). Best effort and off the request path: W08's wait times out to the
// review_timeout branch if the resume does not arrive. The URL is opened from the vault only here
// and never logged.
func (s *Server) clipsResumeW08(ctx context.Context, tenant, stage string, sealed []byte, rater, decision string, marks []clips.RaterMark) {
	if s.deps.N8NResumeToken == "" || s.deps.Vault == nil {
		s.deps.Log.InfoContext(ctx, "clip rating saved; W08 resume not configured (N8N_RESUME_AUTH_TOKEN)", "stage", stage)
		return
	}
	u, err := s.deps.Vault.DecryptString(tenant, clipsResumeURLField, sealed)
	if err != nil {
		s.deps.Log.WarnContext(ctx, "W08 resume url unreadable", "stage", stage)
		return
	}
	mj, _ := json.Marshal(marks)
	sum := sha256.Sum256(mj)
	body, _ := json.Marshal(map[string]string{"stage": stage, "rater_id": rater, "decision": decision,
		"windows_hash": "sha256:" + hex.EncodeToString(sum[:])})
	hc := s.deps.ResumeHTTP
	if hc == nil {
		hc = &http.Client{Timeout: 5 * time.Second}
	}
	token, log := s.deps.N8NResumeToken, s.deps.Log
	bg := context.WithoutCancel(ctx)
	go func() {
		ctx, cancel := context.WithTimeout(bg, 5*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(body))
		if err != nil {
			log.WarnContext(ctx, "W08 resume request invalid", "stage", stage)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-MD-Resume-Token", token)
		resp, err := hc.Do(req)
		if err != nil {
			log.WarnContext(ctx, "W08 resume failed", "stage", stage)
			return
		}
		_ = resp.Body.Close()
		if resp.StatusCode >= 300 {
			log.WarnContext(ctx, "W08 resume rejected", "stage", stage, "status", resp.StatusCode)
		}
	}()
}
