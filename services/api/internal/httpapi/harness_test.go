package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/sruj08/margadarshak/services/api/internal/app"
	"github.com/sruj08/margadarshak/services/api/internal/platform/config"
	"github.com/sruj08/margadarshak/services/api/internal/platform/hmacsig"
	"github.com/sruj08/margadarshak/services/api/internal/platform/logging"
	"github.com/sruj08/margadarshak/services/api/internal/platform/servertime"
	"github.com/sruj08/margadarshak/services/api/internal/ports"
	"github.com/sruj08/margadarshak/services/api/internal/testdb"
)

func TestMain(m *testing.M) {
	code := testdb.Main(m)
	stopSharedVerifier()
	os.Exit(code)
}

var testNow = time.Date(2026, 10, 24, 4, 30, 0, 0, time.UTC)

// captureEmail records e-mails instead of sending them (magic links are read from here).
type captureEmail struct {
	mu   sync.Mutex
	msgs []ports.Message
}

func (c *captureEmail) Name() string { return "capture" }
func (c *captureEmail) Send(_ context.Context, m ports.Message) (ports.DeliveryResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.msgs = append(c.msgs, m)
	return ports.DeliveryResult{Status: ports.DeliverySent, Provider: "capture", ProviderMessageID: "cap-1"}, nil
}

func (c *captureEmail) lastCode(t *testing.T) string {
	t.Helper()
	c.mu.Lock()
	defer c.mu.Unlock()
	require.NotEmpty(t, c.msgs, "no e-mail captured")
	u, err := url.Parse(c.msgs[len(c.msgs)-1].Vars["link"])
	require.NoError(t, err)
	return u.Query().Get("code")
}

type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

type env struct {
	t     *testing.T
	app   *app.App
	srv   *httptest.Server
	clock *servertime.Fixed
	email *captureEmail
	logs  *syncBuffer
	cfg   *config.Config
}

// newEnv builds the API on a fresh database. opts adjust app.Options (P2 tests pass a fake
// compute service and a temp object store).
func newEnv(t *testing.T, opts ...func(*app.Options)) *env {
	t.Helper()
	return newEnvCfg(t, nil, opts...)
}

// newEnvCfg is newEnv with a config mutation applied before the app is built.
func newEnvCfg(t *testing.T, mutate func(*config.Config), opts ...func(*app.Options)) *env {
	t.Helper()
	db := testdb.Open(t)
	srv := httptest.NewUnstartedServer(http.NotFoundHandler())
	srv.Start()
	t.Cleanup(srv.Close)
	cfg := config.ForTest()
	cfg.PublicBaseURL = srv.URL
	if mutate != nil {
		mutate(cfg)
	}
	logs := &syncBuffer{}
	e := &env{t: t, srv: srv, clock: servertime.NewFixed(testNow), email: &captureEmail{}, logs: logs, cfg: cfg}
	o := app.Options{Clock: e.clock, Email: e.email}
	for _, f := range opts {
		f(&o)
	}
	a, err := app.New(cfg, db, logging.New(logs, "debug"), o)
	require.NoError(t, err)
	srv.Config.Handler = a.Handler
	e.app = a
	return e
}

// client is a browser-like client with its own cookie jar.
type client struct {
	e      *env
	hc     *http.Client
	bearer string
}

func (e *env) client() *client {
	jar, _ := cookiejar.New(nil)
	return &client{e: e, hc: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

type resp struct {
	Status int
	Header http.Header
	Body   []byte
}

func (r resp) json(t *testing.T) map[string]any {
	t.Helper()
	var m map[string]any
	require.NoErrorf(t, json.Unmarshal(r.Body, &m), "body: %s", r.Body)
	return m
}

func (c *client) do(method, path string, body any, hdr map[string]string) resp {
	c.e.t.Helper()
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case []byte:
		rd = bytes.NewReader(b)
	case string:
		rd = strings.NewReader(b)
	default:
		raw, err := json.Marshal(b)
		require.NoError(c.e.t, err)
		rd = bytes.NewReader(raw)
	}
	u := path
	if !strings.HasPrefix(path, "http") {
		u = c.e.srv.URL + path
	}
	req, err := http.NewRequest(method, u, rd)
	require.NoError(c.e.t, err)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("X-Tenant", "JK")
	if method != http.MethodGet {
		req.Header.Set("X-Requested-With", "margdarshak")
	}
	if c.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+c.bearer)
	}
	for k, v := range hdr {
		if v == "" {
			req.Header.Del(k)
		} else {
			req.Header.Set(k, v)
		}
	}
	res, err := c.hc.Do(req)
	require.NoError(c.e.t, err)
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return resp{Status: res.StatusCode, Header: res.Header, Body: b}
}

// deviceSession registers an anonymous device and returns the client.
func (e *env) deviceClient() *client {
	c := e.client()
	r := c.do("POST", "/v1/sessions/device", map[string]any{"device_public_key": "MCowBQYDK2VwAyEA3b1testkey", "platform": "android_web"}, nil)
	require.Equalf(e.t, http.StatusCreated, r.Status, "%s", r.Body)
	return c
}

// signIn signs the client in with a magic link for email.
func (c *client) signIn(email string) resp {
	c.e.t.Helper()
	r := c.do("POST", "/v1/auth/magic-link", map[string]any{"email": email}, nil)
	require.Equalf(c.e.t, http.StatusAccepted, r.Status, "%s", r.Body)
	r = c.do("POST", "/v1/auth/token", map[string]any{"grant_type": "magic_link", "code": c.e.email.lastCode(c.e.t)}, nil)
	require.Equalf(c.e.t, http.StatusOK, r.Status, "%s", r.Body)
	return r
}

func (e *env) userClient(email string) *client {
	c := e.deviceClient()
	c.signIn(email)
	return c
}

// internal sends a signed /internal request (n8n).
func (e *env) internal(path string, body any, mutate func(h http.Header, raw []byte) []byte) resp {
	e.t.Helper()
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", e.srv.URL+path, nil)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+e.cfg.InternalBearerTokens[0])
	req.Header.Set(hmacsig.Header, hmacsig.Sign([]byte(e.cfg.InternalHMACSecret), e.clock.Now(), raw))
	if mutate != nil {
		raw = mutate(req.Header, raw)
	}
	req.Body = io.NopCloser(bytes.NewReader(raw))
	req.ContentLength = int64(len(raw))
	res, err := http.DefaultClient.Do(req)
	require.NoError(e.t, err)
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return resp{Status: res.StatusCode, Header: res.Header, Body: b}
}

// ---- Contract validation against api/openapi.yaml (MD-055) ----------------------------------

var (
	specOnce sync.Once
	specDoc  any
	specErr  error
	compiler *jsonschema.Compiler
	cmu      sync.Mutex
)

const specURL = "mem://openapi.json"

func loadSpec(t *testing.T) map[string]any {
	t.Helper()
	specOnce.Do(func() {
		root, _ := os.Getwd()
		var raw []byte
		raw, specErr = os.ReadFile(filepath.Join(root, "..", "..", "..", "..", "api", "openapi.yaml"))
		if specErr != nil {
			return
		}
		var y any
		if specErr = yaml.Unmarshal(raw, &y); specErr != nil {
			return
		}
		j, err := json.Marshal(y)
		if err != nil {
			specErr = err
			return
		}
		specDoc, specErr = jsonschema.UnmarshalJSON(bytes.NewReader(j))
		if specErr != nil {
			return
		}
		compiler = jsonschema.NewCompiler()
		compiler.DefaultDraft(jsonschema.Draft2020)
		specErr = compiler.AddResource(specURL, specDoc)
	})
	require.NoError(t, specErr)
	return specDoc.(map[string]any)
}

func esc(s string) string { return strings.ReplaceAll(strings.ReplaceAll(s, "~", "~0"), "/", "~1") }

// assertContract validates a response body against the schema the spec declares for
// (method, path template, status).
func assertContract(t *testing.T, method, pathTemplate string, r resp) {
	t.Helper()
	doc := loadSpec(t)
	paths := doc["paths"].(map[string]any)
	item, ok := paths[pathTemplate].(map[string]any)
	require.Truef(t, ok, "path %s not in spec", pathTemplate)
	op, ok := item[strings.ToLower(method)].(map[string]any)
	require.Truef(t, ok, "%s %s not in spec", method, pathTemplate)
	responses := op["responses"].(map[string]any)
	key := strconv.Itoa(r.Status)
	resObj, ok := responses[key].(map[string]any)
	require.Truef(t, ok, "%s %s: status %d not declared in spec (body %s)", method, pathTemplate, r.Status, r.Body)
	ptr := "#/paths/" + esc(pathTemplate) + "/" + strings.ToLower(method) + "/responses/" + key
	if ref, ok := resObj["$ref"].(string); ok {
		ptr = ref
		name := strings.TrimPrefix(ref, "#/components/responses/")
		resObj = doc["components"].(map[string]any)["responses"].(map[string]any)[name].(map[string]any)
	}
	content, ok := resObj["content"].(map[string]any)
	if !ok {
		require.Empty(t, strings.TrimSpace(string(r.Body)), "spec declares no body")
		return
	}
	ct := strings.Split(r.Header.Get("Content-Type"), ";")[0]
	if _, ok := content[ct]; !ok {
		t.Fatalf("%s %s %d: content type %q not declared", method, pathTemplate, r.Status, ct)
	}
	cmu.Lock()
	sch, err := compiler.Compile(specURL + ptr + "/content/" + esc(ct) + "/schema")
	cmu.Unlock()
	require.NoError(t, err)
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(r.Body))
	require.NoError(t, err)
	require.NoErrorf(t, sch.Validate(inst), "%s %s %d response drifts from the spec: %s", method, pathTemplate, r.Status, r.Body)
}

func assertProblem(t *testing.T, r resp, status int, code string) {
	t.Helper()
	require.Equalf(t, status, r.Status, "%s", r.Body)
	require.Equal(t, "application/problem+json", strings.Split(r.Header.Get("Content-Type"), ";")[0])
	loadSpec(t)
	cmu.Lock()
	sch, err := compiler.Compile(specURL + "#/components/schemas/Problem")
	cmu.Unlock()
	require.NoError(t, err)
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(r.Body))
	require.NoError(t, err)
	require.NoError(t, sch.Validate(inst))
	if code != "" {
		require.Equal(t, code, r.json(t)["code"], "%s", r.Body)
	}
}
