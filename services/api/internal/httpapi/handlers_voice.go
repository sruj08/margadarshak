package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"

	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/guard"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/ai/voiceguide"
	"github.com/sruj08/margadarshak/services/api/internal/adapters/speech"
	"github.com/sruj08/margadarshak/services/api/internal/httpapi/gen"
)

const (
	voiceTicketTTL   = 60 * time.Second
	voiceHelloWait   = 5 * time.Second
	voiceMaxSession  = 10 * time.Minute
	voiceMaxFrame    = 64 << 10
	voiceMaxPTTBytes = 16000 * 2 * 30 // 30 s of PCM16 16 kHz for one Dogri push-to-talk turn
)

type voiceTicket struct {
	tenant    string
	applicant uuid.UUID
	useAI     bool
	expires   time.Time
}

// voiceState holds the single-use tickets and the monthly voice seconds per account.
// shortcut: process memory; a restart forgets tickets (60 s) and resets the month's usage; move to
// Key Value when the API runs more than one instance.
type voiceState struct {
	mu      sync.Mutex
	tickets map[string]voiceTicket
	seconds map[string]int // tenant/applicant/yyyy-mm -> seconds used
}

func newVoiceState() *voiceState {
	return &voiceState{tickets: map[string]voiceTicket{}, seconds: map[string]int{}}
}

func (v *voiceState) issue(t voiceTicket) string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	id := hex.EncodeToString(b)
	v.mu.Lock()
	defer v.mu.Unlock()
	now := time.Now()
	for k, x := range v.tickets {
		if now.After(x.expires) {
			delete(v.tickets, k)
		}
	}
	v.tickets[id] = t
	return id
}

// redeem consumes a ticket once.
func (v *voiceState) redeem(id string, now time.Time) (voiceTicket, bool) {
	v.mu.Lock()
	defer v.mu.Unlock()
	t, ok := v.tickets[id]
	delete(v.tickets, id)
	return t, ok && now.Before(t.expires)
}

func usageKey(tenant string, applicant uuid.UUID, now time.Time) string {
	return tenant + "/" + applicant.String() + "/" + now.Format("2006-01")
}

func (v *voiceState) used(key string) int {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.seconds[key]
}

func (v *voiceState) add(key string, secs int) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.seconds[key] += secs
}

func (s *Server) voiceCapSeconds() int {
	if s.deps.VoiceCapMin > 0 {
		return s.deps.VoiceCapMin * 60
	}
	return 10 * 60
}

// CreateVoiceTicket is API-40's ticket: the AI gate and the monthly cap run here.
func (s *Server) CreateVoiceTicket(w http.ResponseWriter, r *http.Request) {
	if s.deps.Voice == nil {
		serviceMissing(w, r)
		return
	}
	if reason := s.aiGate(r, aiVoiceFeature); reason != "" {
		aiRefused(w, r, reason, "ai_voice")
		return
	}
	p := principalFrom(r.Context())
	now := s.now()
	if s.voice.used(usageKey(p.Tenant, p.ApplicantID, now)) >= s.voiceCapSeconds() {
		writeProblem(w, r, Problem{Status: http.StatusTooManyRequests, Code: "VOICE_CAP_REACHED", Detail: "this month's voice minutes are used up; type instead"})
		return
	}
	expires := now.Add(voiceTicketTTL)
	id := s.voice.issue(voiceTicket{tenant: p.Tenant, applicant: p.ApplicantID, useAI: true, expires: expires})
	writeJSON(w, http.StatusCreated, map[string]any{"ticket": id, "expires_at": expires.UTC(), "live": s.deps.Voice.LiveEnabled()})
}

var voiceUpgrader = websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096, CheckOrigin: func(*http.Request) bool { return true }}

// hijackable unwraps middleware response writers to the one that can hijack the connection.
func hijackable(w http.ResponseWriter) http.ResponseWriter {
	for {
		if _, ok := w.(http.Hijacker); ok {
			return w
		}
		u, ok := w.(interface{ Unwrap() http.ResponseWriter })
		if !ok {
			return w
		}
		w = u.Unwrap()
	}
}

type voiceClientMsg struct {
	Type            string `json:"type"`
	V               int    `json:"v"`
	Locale          string `json:"locale"`
	Screen          string `json:"screen"`
	Token           string `json:"token"`
	ScreenID        string `json:"screen_id"`
	ConfirmActionID string `json:"confirm_action_id"`
	Text            string `json:"text"`
}

// OpenVoiceSocket is API-40. Origin checks are not needed: nothing is authorised by cookies; the
// single-use ticket in the first frame is the credential.
func (s *Server) OpenVoiceSocket(w http.ResponseWriter, r *http.Request, params gen.OpenVoiceSocketParams) {
	if s.deps.Voice == nil {
		serviceMissing(w, r)
		return
	}
	ws, err := voiceUpgrader.Upgrade(hijackable(w), r, nil)
	if err != nil {
		return // the upgrader already answered
	}
	defer func() { _ = ws.Close() }()
	ws.SetReadLimit(voiceMaxFrame)
	var mu sync.Mutex
	send := func(m voiceguide.Message) {
		mu.Lock()
		defer mu.Unlock()
		_ = ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
		_ = ws.WriteJSON(m)
	}
	sendAudio := func(b []byte) {
		mu.Lock()
		defer mu.Unlock()
		_ = ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
		_ = ws.WriteMessage(websocket.BinaryMessage, b)
	}

	_ = ws.SetReadDeadline(time.Now().Add(voiceHelloWait))
	var hello voiceClientMsg
	if err := ws.ReadJSON(&hello); err != nil || hello.Type != "hello" {
		send(voiceguide.Message{Type: "error", ReasonKey: "voice.ticket_invalid"})
		return
	}
	t, ok := s.voice.redeem(hello.Token, s.now())
	if tn := tenantFrom(r.Context()); !ok || tn == nil || tn.TenantID != t.tenant {
		send(voiceguide.Message{Type: "error", ReasonKey: "voice.ticket_invalid"})
		return
	}
	locale := "hi"
	if params.Lang != nil {
		locale = string(*params.Lang)
	}
	switch hello.Locale {
	case "en", "hi", "doi", "pa", "mr", "gu", "ta":
		locale = hello.Locale
	}
	ctx, cancel := context.WithTimeout(r.Context(), voiceMaxSession)
	defer cancel()
	start := time.Now()
	defer func() {
		s.voice.add(usageKey(t.tenant, t.applicant, s.now()), int(time.Since(start).Seconds())+1)
	}()

	userID := t.tenant + ":" + t.applicant.String()
	conn, err := s.deps.Voice.Open(ctx, userID, locale, hello.Screen, nil)
	if err != nil {
		send(voiceguide.Message{Type: "error", ReasonKey: "voice.unavailable"})
		return
	}
	defer s.deps.Voice.Close(conn)

	// Live audio (Path A) for hi/en when available; Dogri and outages use text turns.
	var live *voiceguide.Live
	liveConn := conn
	if locale != "doi" && s.deps.Voice.LiveEnabled() {
		lc, err := s.deps.Voice.Open(ctx, userID, locale, hello.Screen, send)
		if err == nil {
			liveConn = lc
			defer s.deps.Voice.Close(lc)
			if live, err = s.deps.Voice.StartLive(ctx, lc); err != nil {
				s.deps.Log.WarnContext(ctx, "voice live unavailable; text turns", "err", err)
				live = nil
			}
		}
	}
	if live != nil {
		defer live.Close()
		go func() {
			err := s.deps.Voice.Pump(ctx, liveConn, live, sendAudio)
			if errors.Is(err, voiceguide.ErrPII) {
				send(voiceguide.Message{Type: "session_end", ReasonKey: "voice.pii_restart"})
			} else if err != nil {
				send(voiceguide.Message{Type: "error", ReasonKey: "voice.live_failed"})
			}
			cancel()
		}()
	}

	var ptt []byte
	for {
		_ = ws.SetReadDeadline(time.Now().Add(voiceMaxSession))
		kind, data, err := ws.ReadMessage()
		if err != nil || ctx.Err() != nil {
			return
		}
		if kind == websocket.BinaryMessage {
			switch {
			case live != nil:
				if err := live.SendAudio(data); err != nil {
					send(voiceguide.Message{Type: "error", ReasonKey: "voice.live_failed"})
					return
				}
			case len(ptt)+len(data) <= voiceMaxPTTBytes:
				ptt = append(ptt, data...)
			}
			continue
		}
		var m voiceClientMsg
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		switch m.Type {
		case "ui_state":
			conn.SetScreen(m.ScreenID)
			liveConn.SetScreen(m.ScreenID)
		case "text":
			text := strings.TrimSpace(m.Text)
			if text == "" || len([]rune(text)) > 500 {
				continue
			}
			for _, out := range s.deps.Voice.TextTurn(ctx, conn, text, t.useAI) {
				send(out)
			}
			if locale == "doi" {
				s.speakHindi(ctx, conn, sendAudio)
			}
		case "confirm":
			for _, out := range s.deps.Voice.Confirm(conn, m.ConfirmActionID) {
				send(out)
			}
		case "cancel":
			send(voiceguide.Message{Type: "interrupted"})
		case "stop":
			if locale != "doi" || len(ptt) == 0 {
				continue
			}
			s.dogriTranscript(ctx, ptt, send)
			ptt = nil
		}
	}
}

// dogriTranscript is the cascade's first leg: Saaras turns the push-to-talk audio into a Dogri
// transcript that the client shows for editing; the confirmed text comes back as a text frame.
func (s *Server) dogriTranscript(ctx context.Context, pcm []byte, send func(voiceguide.Message)) {
	if s.deps.Speech == nil {
		send(voiceguide.Message{Type: "error", ReasonKey: "voice.dogri_unavailable"})
		return
	}
	text, err := s.deps.Speech.STT(ctx, speech.WAV(pcm, 16000), "doi-IN")
	if err != nil || text == "" {
		send(voiceguide.Message{Type: "error", ReasonKey: "voice.dogri_unavailable"})
		return
	}
	if kind, refuse := guard.MustRefuse(text); refuse {
		send(voiceguide.Message{Type: "pii_blocked", ReasonKey: "pii." + kind})
		send(voiceguide.Message{Type: "transcript_out", Text: guard.PIIRefusal("doi")})
		return
	}
	send(voiceguide.Message{Type: "transcript_in", Text: text})
}

// speakHindi is the cascade's last leg: the last reply is spoken by Bulbul in Hindi.
func (s *Server) speakHindi(ctx context.Context, conn *voiceguide.Conn, sendAudio func([]byte)) {
	if s.deps.Speech == nil {
		return
	}
	reply := conn.LastReply()
	if reply == "" {
		return
	}
	if audio, err := s.deps.Speech.TTS(ctx, reply, "hi-IN"); err == nil {
		sendAudio(audio)
	}
}
