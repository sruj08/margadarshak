// Validates the n8n exports this package's owner maintains (W01, W02, W08, W13, W14) and runs their Code
// nodes' signing/verification snippets against the same verifier the Go API uses.
//   node --test --experimental-strip-types services/workflows/test/n8n-workflows.test.ts
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { verify } from "../src/lib/hmac.ts";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "n8n", "workflows");
const OWNED = /^W(01|02|08|13|14)-.*\.json$/;
const SECRET = "n8n-test-secret";
const require = createRequire(import.meta.url);

interface N8nNode {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  disabled?: boolean;
  onError?: string;
  webhookId?: string;
  credentials?: Record<string, { id: string; name: string }>;
}
interface Conn {
  node: string;
  type: string;
  index: number;
}
interface Workflow {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main: Conn[][] }>;
  settings: Record<string, unknown>;
  meta?: { margdarshak?: { workflow_id?: string } };
}

const files = readdirSync(DIR).filter((f) => /^W\d{2}-.*\.json$/.test(f));
const load = (f: string): Workflow => JSON.parse(readFileSync(join(DIR, f), "utf8")) as Workflow;
const byPrefix = (p: string): Workflow => load(files.find((f) => f.startsWith(p))!);
const node = (wf: Workflow, name: string): N8nNode => {
  const n = wf.nodes.find((x) => x.name === name);
  assert.ok(n, `${wf.name}: node ${name} missing`);
  return n;
};

const TRIGGERS = new Set(["n8n-nodes-base.scheduleTrigger", "n8n-nodes-base.webhook", "n8n-nodes-base.errorTrigger", "n8n-nodes-base.formTrigger", "n8n-nodes-base.manualTrigger"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function maxOutputs(n: N8nNode): number {
  return baseOutputs(n) + (n.onError === "continueErrorOutput" ? 1 : 0);
}

function baseOutputs(n: N8nNode): number {
  if (n.type === "n8n-nodes-base.if") return 2;
  if (n.type === "n8n-nodes-base.splitInBatches") return 2;
  if (n.type === "n8n-nodes-base.switch") {
    const rules = ((n.parameters["rules"] as { values?: unknown[] })?.values ?? []).length;
    const fb = (n.parameters["options"] as { fallbackOutput?: string })?.fallbackOutput === "extra" ? 1 : 0;
    return rules + fb;
  }
  return 1;
}

/** Structural checks n8n's importer relies on; returns a list of problems. */
export function validateWorkflow(wf: Workflow): string[] {
  const errs: string[] = [];
  if (typeof wf.name !== "string" || !wf.name) errs.push("missing name");
  if (!Array.isArray(wf.nodes) || wf.nodes.length === 0) return [...errs, "no nodes"];
  if (!wf.connections || typeof wf.connections !== "object") errs.push("no connections");
  const names = new Map<string, N8nNode>();
  const ids = new Set<string>();
  const hooks = new Set<string>();
  for (const n of wf.nodes) {
    if (!UUID.test(n.id)) errs.push(`bad id ${n.id} on ${n.name}`);
    if (ids.has(n.id)) errs.push(`duplicate id ${n.id}`);
    ids.add(n.id);
    if (names.has(n.name)) errs.push(`duplicate name ${n.name}`);
    names.set(n.name, n);
    if (!/^n8n-nodes-base\.[A-Za-z]+$/.test(n.type)) errs.push(`bad type ${n.type}`);
    if (typeof n.typeVersion !== "number") errs.push(`no typeVersion on ${n.name}`);
    if (!Array.isArray(n.position) || n.position.length !== 2) errs.push(`bad position on ${n.name}`);
    if (!n.parameters || typeof n.parameters !== "object") errs.push(`no parameters on ${n.name}`);
    for (const [k, c] of Object.entries(n.credentials ?? {})) {
      if (c.id !== "REPLACE_ON_IMPORT") errs.push(`credential ${k} on ${n.name} is not REPLACE_ON_IMPORT`);
    }
    if (n.webhookId) {
      if (hooks.has(n.webhookId)) errs.push(`duplicate webhookId ${n.webhookId}`);
      hooks.add(n.webhookId);
    }
    if ((n.type === "n8n-nodes-base.wait" || n.type === "n8n-nodes-base.webhook") && !n.webhookId) errs.push(`${n.name} has no webhookId`);
  }
  const incoming = new Map<string, number>();
  for (const [src, outs] of Object.entries(wf.connections ?? {})) {
    const s = names.get(src);
    if (!s) {
      errs.push(`connection from unknown node ${src}`);
      continue;
    }
    if (!Array.isArray(outs.main)) errs.push(`connections of ${src} have no main`);
    if (outs.main.length > maxOutputs(s)) errs.push(`${src} has ${outs.main.length} outputs > ${maxOutputs(s)}`);
    for (const branch of outs.main) {
      for (const c of branch) {
        if (!names.has(c.node)) errs.push(`connection ${src} -> unknown node ${c.node}`);
        if (c.type !== "main" || c.index !== 0) errs.push(`connection ${src} -> ${c.node} has type/index ${c.type}/${c.index}`);
        incoming.set(c.node, (incoming.get(c.node) ?? 0) + 1);
      }
    }
  }
  // Every node is a trigger or reachable from one; triggers have no inputs.
  const reach = new Set<string>();
  const stack = wf.nodes.filter((n) => TRIGGERS.has(n.type)).map((n) => n.name);
  if (stack.length === 0) errs.push("no trigger node");
  for (const t of stack) if (incoming.has(t)) errs.push(`trigger ${t} has an input`);
  while (stack.length) {
    const cur = stack.pop()!;
    if (reach.has(cur)) continue;
    reach.add(cur);
    for (const b of wf.connections[cur]?.main ?? []) for (const c of b) stack.push(c.node);
  }
  for (const n of wf.nodes) if (!reach.has(n.name)) errs.push(`unreachable node ${n.name}`);
  return errs;
}

/** Runs a Code node's jsCode the way n8n does (function body with $-helpers in scope). */
function runCode(code: string, scope: Record<string, unknown>): Array<{ json: Record<string, unknown> }> {
  const keys = Object.keys(scope);
  const fn = new Function("require", ...keys, code) as (...a: unknown[]) => unknown;
  return fn(require, ...keys.map((k) => scope[k])) as Array<{ json: Record<string, unknown> }>;
}

const luxonLikeNow = (iso: string) => ({ setZone: () => ({ toFormat: () => iso }) });

describe("n8n exports: structure (all W*.json)", () => {
  for (const f of files) {
    it(`${f} is valid n8n workflow JSON`, () => {
      const wf = load(f);
      assert.deepEqual(validateWorkflow(wf), []);
      assert.equal(wf.settings["timezone"], "Asia/Kolkata");
    });
  }
  it("the owned exports W01, W02, W08, W13 and W14 are present", () => {
    assert.deepEqual(files.filter((f) => OWNED.test(f)).map((f) => f.slice(0, 3)).sort(), ["W01", "W02", "W08", "W13", "W14"]);
  });
});

describe("W01 case-clock tick (MD-127)", () => {
  const wf = byPrefix("W01-");
  it("runs daily at 08:00 IST and calls API-65 with the signed body", () => {
    const sched = node(wf, "Every day 08:00 IST");
    assert.equal((sched.parameters["rule"] as { interval: { expression: string }[] }).interval[0]!.expression, "0 0 8 * * *");
    const http = node(wf, "API-65 start sweep");
    assert.equal(http.parameters["url"], "={{ $vars.MD_API_BASE }}/internal/clock/sweep");
    assert.equal(http.parameters["body"], "={{ $json.body }}");
    const headers = (http.parameters["headerParameters"] as { parameters: { name: string; value: string }[] }).parameters;
    assert.deepEqual(headers.map((h) => h.name).sort(), ["Authorization", "Content-Type", "Idempotency-Key", "Margdarshak-Signature"]);
    assert.notEqual(http.parameters["retryOnFail"], true, "retries must loop through the signing node (replay cache)");
  });
  it("its Code node produces a Margdarshak-Signature the Go-scheme verifier accepts", () => {
    const code = node(wf, "Build + sign sweep request (HMAC)").parameters["jsCode"] as string;
    const [out] = runCode(code, { $now: luxonLikeNow("2026-10-24"), $vars: { MD_HMAC_SECRET: SECRET } });
    const j = out!.json as { body: string; signature: string; idempotency_key: string };
    const v = verify(SECRET, j.signature, j.body, Math.floor(Date.now() / 1000));
    assert.equal(v.ok, true);
    assert.equal(j.idempotency_key, "case-clock:2026-10-24");
    assert.ok(j.idempotency_key.length >= 16 && j.idempotency_key.length <= 64);
    const body = JSON.parse(j.body) as Record<string, unknown>;
    assert.equal(body["sweep_id"], "sweep-2026-10-24-0800");
    assert.equal(typeof body["as_of"], "string"); // ClockSweepRequest requires sweep_id + as_of
  });
  it("has no rule logic: no fee, date maths or eligibility in Code nodes", () => {
    for (const n of wf.nodes.filter((x) => x.type === "n8n-nodes-base.code")) {
      const c = n.parameters["jsCode"] as string;
      assert.doesNotMatch(c, /fee|paise|₹|min_wait|eligib|addDays|plus\(\{/i, n.name);
    }
  });
});

describe("W02 milestone notifier (MD-128)", () => {
  const wf = byPrefix("W02-");
  const verifyCode = node(wf, "Verify envelope (HMAC)").parameters["jsCode"] as string;
  const envelope = (payload: string, ts: number, secret = SECRET) => ({
    ts: String(ts),
    payload,
    sig: `sha256=${createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex")}`,
  });
  const run = (body: unknown) => runCode(verifyCode, { $json: { body }, $vars: { MD_HMAC_SECRET: SECRET } })[0]!.json;

  it("accepts a fresh, correctly signed envelope and rejects tampered, stale or wrong-key ones", () => {
    const now = Math.floor(Date.now() / 1000);
    const p = JSON.stringify({ event: "ll_issued", event_id: "evt_1", messages: [] });
    assert.equal(run(envelope(p, now))["valid"], true);
    assert.equal(run({ ...envelope(p, now), payload: p.replace("evt_1", "evt_2") })["reason"], "bad_signature");
    assert.equal(run(envelope(p, now - 301))["reason"], "stale");
    assert.equal(run(envelope(p, now, "other"))["reason"], "bad_signature");
    assert.equal(run({})["valid"], false);
  });

  it("drops a message whose idempotency key it has already handled", () => {
    const code = node(wf, "Split + drop duplicate keys").parameters["jsCode"] as string;
    const store: Record<string, unknown> = {};
    const payload = {
      event: "clock_batch",
      event_id: "evt_9",
      messages: [
        { notification_id: "ntf_1", idempotency_key: "cas_A:LL_EXPIRY_M7:2026-10-24:whatsapp", channel: "whatsapp", to: "+910000000000", template_id: "md_ll_expiry_t7_v1" },
        { notification_id: "ntf_2", idempotency_key: "cas_B:LL_EXPIRY_M7:2026-10-24:email", channel: "email", to: "x@example.invalid", template_id: "md_ll_expiry_t7_v1" },
      ],
    };
    const scope = {
      $: () => ({ first: () => ({ json: { payload } }) }),
      $getWorkflowStaticData: () => store,
    };
    assert.equal(runCode(code, scope).length, 2);
    assert.equal(runCode(code, scope).length, 0, "a retried batch sends nothing twice");
  });

  it("keeps the SMS branch disabled, labelled and unconnected (no SMS call possible)", () => {
    const sms = wf.nodes.filter((n) => /sms/i.test(n.name));
    assert.equal(sms.length, 1);
    assert.equal(sms[0]!.disabled, true);
    assert.match(sms[0]!.name, /DISABLED/);
    assert.equal(sms[0]!.credentials, undefined);
    assert.equal(wf.connections[sms[0]!.name], undefined);
    for (const n of wf.nodes.filter((x) => !x.disabled && x.type === "n8n-nodes-base.httpRequest")) {
      assert.doesNotMatch(String(n.parameters["url"]), /sms/i, n.name);
    }
  });

  it("verifies before any work and answers 202/401 from Respond nodes", () => {
    assert.deepEqual(wf.connections["Milestone event (from API)"]!.main[0]!.map((c) => c.node), ["Verify envelope (HMAC)"]);
    assert.equal((node(wf, "Respond 202").parameters["options"] as { responseCode: number }).responseCode, 202);
    assert.equal((node(wf, "Respond 401").parameters["options"] as { responseCode: number }).responseCode, 401);
    assert.equal(wf.settings["saveDataSuccessExecution"], "none", "keep phone numbers out of execution logs");
  });
});

describe("W13 analytics digest (MD-141)", () => {
  const wf = byPrefix("W13-");
  it("is weekly, reads the digest through the backend and never touches Postgres", () => {
    const weekly = node(wf, "Every Monday 21:00 IST");
    assert.equal((weekly.parameters["rule"] as { interval: { expression: string }[] }).interval[0]!.expression, "0 0 21 * * 1");
    assert.ok(!wf.nodes.some((n) => /postgres|mysql|sql/i.test(n.type)));
    assert.equal(node(wf, "GET /internal/analytics/digest").parameters["url"], "={{ $vars.MD_API_BASE }}/internal/analytics/digest");
    assert.ok(wf.nodes.some((n) => n.type === "n8n-nodes-base.slack"));
    assert.ok(wf.nodes.some((n) => n.type === "n8n-nodes-base.gmail"));
  });
  it("signs the GET with an empty body", () => {
    const code = node(wf, "Sign digest request (HMAC)").parameters["jsCode"] as string;
    const [out] = runCode(code, {
      $vars: { MD_HMAC_SECRET: SECRET },
      $: () => ({ isExecuted: false }),
    });
    assert.equal(out!.json["period"], "week");
    assert.equal(verify(SECRET, out!.json["signature"] as string, "", Math.floor(Date.now() / 1000)).ok, true);
  });
});

// ---- P2: W08 (re-pointed to the internal clip endpoints) and W14 (field test) -------------

type Headers = { parameters: { name: string; value: string }[] };
const headerNames = (n: N8nNode) => ((n.parameters["headerParameters"] as Headers | undefined)?.parameters ?? []).map((h) => h.name).sort();
const SIGNED_HEADERS = ["Authorization", "Content-Type", "Idempotency-Key", "Margdarshak-Signature"];
const nowS = () => Math.floor(Date.now() / 1000);
const outgoing = (wf: Workflow, name: string) => (wf.connections[name]?.main ?? []).map((b) => b.map((c) => c.node));

/** `$('Node')` accessor for runCode: first()/item/isExecuted over canned node outputs. */
function nodeAccessor(outputs: Record<string, Record<string, unknown>>) {
  return (name: string) => {
    const json = outputs[name];
    return { first: () => ({ json: json ?? {} }), item: { json: json ?? {} }, isExecuted: json !== undefined };
  };
}

/** Every signed POST to the backend: four headers, raw signed body, no built-in retry, ok/retry/fail switch. */
function assertSignedPosts(wf: Workflow, urls: RegExp[]) {
  const posts = wf.nodes.filter((n) => n.type === "n8n-nodes-base.httpRequest" && n.parameters["method"] === "POST");
  assert.equal(posts.length, urls.length, `${wf.name}: POST count`);
  for (const [i, re] of urls.entries()) assert.match(String(posts[i]!.parameters["url"]), re);
  for (const p of posts) {
    assert.deepEqual(headerNames(p), SIGNED_HEADERS, p.name);
    assert.equal(p.parameters["contentType"], "raw", p.name);
    assert.equal(p.parameters["body"], "={{ $json.body }}", p.name);
    assert.notEqual(p.retryOnFail, true, `${p.name}: retries must loop through the signing node (replay cache)`);
    assert.equal(p.onError, "continueRegularOutput", p.name);
    const sw = node(wf, outgoing(wf, p.name)[0]![0]!);
    assert.equal(sw.type, "n8n-nodes-base.switch");
    const [ok, retry, fail] = outgoing(wf, sw.name);
    assert.ok(ok && retry && fail, `${sw.name} has ok/retry/fail`);
    assert.equal(node(wf, retry[0]!).type, "n8n-nodes-base.wait");
    assert.equal(node(wf, fail[0]!).type, "n8n-nodes-base.stopAndError");
    const signer = outgoing(wf, retry[0]!)[0]![0]!;
    assert.equal(node(wf, signer).type, "n8n-nodes-base.code");
    assert.deepEqual(outgoing(wf, signer)[0], [p.name], `${retry[0]} loops back to the signer of ${p.name}`);
  }
}

describe("W08 clip review queue (re-pointed, plan §2.9)", () => {
  const wf = byPrefix("W08-");
  const resumeUrl = "https://example.app.n8n.cloud/webhook-waiting/4711";
  const parse = { clip_id: "JMU-0012", version: 3, proposed_windows_count: 2, blur_audit_url: null };
  const scope = (extra: Record<string, Record<string, unknown>> = {}) => ({
    $vars: { MD_HMAC_SECRET: SECRET },
    $execution: { id: "4711", resumeUrl },
    $: nodeAccessor({ "Parse payload": parse, ...extra }),
  });
  const sign = (name: string, extra: Record<string, Record<string, unknown>> = {}) => {
    const [out] = runCode(node(wf, name).parameters["jsCode"] as string, scope(extra));
    const j = out!.json as { body: string; signature: string; idempotency_key: string; clip_id: string };
    assert.equal(verify(SECRET, j.signature, j.body, nowS()).ok, true, `${name} signature`);
    assert.ok(j.idempotency_key.length >= 16 && j.idempotency_key.length <= 64, j.idempotency_key);
    return { ...j, json: JSON.parse(j.body) as Record<string, unknown> };
  };

  it("calls only the internal endpoints (review-tasks, API-67 clip_finalize, status), never /v1/admin", () => {
    assertSignedPosts(wf, [
      /\/internal\/clips\/\{\{ encodeURIComponent\(\$json\.clip_id\) \}\}\/review-tasks$/,
      /\/internal\/clips\/\{\{ encodeURIComponent\(\$json\.clip_id\) \}\}\/review-tasks$/,
      /^=\{\{ \$vars\.MD_API_BASE \}\}\/internal\/jobs\/clip_finalize$/,
      /\/internal\/clips\/\{\{ encodeURIComponent\(\$json\.clip_id\) \}\}\/status$/,
    ]);
    assert.ok(!JSON.stringify(wf).includes("/v1/admin/"), "no API-55 admin URLs left");
  });

  it("keeps the two-rater structure: webhook → HMAC check → rater 1 wait → rater 2 wait (blind) → finalize", () => {
    assert.equal(node(wf, "Clip ready for review (from Workflows)").parameters["path"], "md/clip-ready");
    assert.deepEqual(outgoing(wf, "Clip ready for review (from Workflows)"), [["Compute expected HMAC"]]);
    const waits = wf.nodes.filter((n) => n.type === "n8n-nodes-base.wait" && n.parameters["resume"] === "webhook");
    assert.deepEqual(
      waits.map((w) => w.name),
      ["Wait for rater 1 (≤ 48 h)", "Wait for rater 2 (≤ 48 h)"],
    );
    for (const w of waits) {
      assert.equal(w.parameters["authentication"], "headerAuth");
      assert.equal(w.credentials?.["httpHeaderAuth"]?.name, "MD resume token");
      assert.deepEqual([w.parameters["limitWaitTime"], w.parameters["resumeAmount"], w.parameters["resumeUnit"]], [true, 48, "hours"]);
    }
    assert.deepEqual(outgoing(wf, "Rater 1 decision"), [["Sign rater-2 task (HMAC)"], ["Sign clip status (HMAC)"], ["Sign clip status (HMAC)"]]);
    assert.deepEqual(outgoing(wf, "Rater 2 set windows?"), [["Sign clip_finalize request (HMAC)"], ["Sign clip status (HMAC)"]]);
    assert.ok(
      !wf.nodes.some((n) => n.type === "n8n-nodes-base.telegram" && /sendAndWait/i.test(JSON.stringify(n.parameters))),
      "Telegram is notification only",
    );
  });

  it("parses clip-pipeline and API clip ids and rejects anything else", () => {
    const code = node(wf, "Parse payload").parameters["jsCode"] as string;
    const run = (p: unknown) =>
      (
        runCode(code, { $: nodeAccessor({ "Clip ready for review (from Workflows)": { body: { payload: JSON.stringify(p) } } }) }) as unknown as {
          json: Record<string, unknown>;
        }
      ).json;
    assert.deepEqual(run({ clip_id: "JMU-0012", version: 3, proposed_windows_count: 2 }), {
      clip_id: "JMU-0012",
      version: 3,
      proposed_windows_count: 2,
      blur_audit_url: null,
    });
    assert.equal(run({ clip_id: "clip_jk00420001" })["version"], 1);
    // The Go clip.open_review envelope: clip-pipeline ids such as KL-0007 / AIG-0004, `proposals` as the count.
    assert.equal(run({ clip_id: "KL-0007", version: 1, proposals: 3 })["proposed_windows_count"], 3);
    assert.equal(run({ clip_id: "AIG-0004" })["clip_id"], "AIG-0004");
    assert.throws(() => run({ clip_id: "../etc/passwd" }), /bad clip_id/);
    assert.throws(() => run({ clip_id: "JMU-0012", version: 0 }), /bad version/);
  });

  it("signs each request with a fresh Margdarshak-Signature and a stable per-execution key", () => {
    const r1 = sign("Sign rater-1 task (HMAC)");
    // Exactly api/openapi.yaml ClipReviewTaskCreate (additionalProperties: false): no version field.
    assert.deepEqual(r1.json, { stage: "rater_1", resume_url: resumeUrl, n8n_execution_id: "4711", due_in_hours: 48 });
    assert.equal(r1.idempotency_key, "clip-review:JMU-0012:v3:rater_1:4711");
    assert.equal(sign("Sign rater-1 task (HMAC)").idempotency_key, r1.idempotency_key, "a re-signed retry keeps its key");

    const r2 = sign("Sign rater-2 task (HMAC)", { "Wait for rater 1 (≤ 48 h)": { body: { decision: "windows_set", rater_id: "usr_r1" } } });
    assert.equal(r2.json["stage"], "rater_2");
    assert.equal(r2.json["exclude_rater_id"], "usr_r1");
    assert.equal(r2.json["blind_to_rater_1"], true);
    assert.deepEqual(Object.keys(r2.json).sort(), ["blind_to_rater_1", "due_in_hours", "exclude_rater_id", "n8n_execution_id", "resume_url", "stage"]);
    assert.notEqual(r2.idempotency_key, r1.idempotency_key);
    const r2NoId = sign("Sign rater-2 task (HMAC)", { "Wait for rater 1 (≤ 48 h)": { body: { decision: "windows_set" } } });
    assert.ok(!("exclude_rater_id" in r2NoId.json), "exclude_rater_id is omitted, never null");

    const fin = sign("Sign clip_finalize request (HMAC)");
    assert.deepEqual(fin.json, { args: { clip_id: "JMU-0012", version: 3, n8n_execution_id: "4711" } });
    assert.ok(Buffer.byteLength(fin.body) <= 4096, "API-67 args <= 4 KB");

    const long = runCode(node(wf, "Sign rater-1 task (HMAC)").parameters["jsCode"] as string, {
      ...scope(),
      $: nodeAccessor({ "Parse payload": { ...parse, clip_id: `clip_${"a".repeat(40)}` } }),
    })[0]!.json["idempotency_key"] as string;
    assert.ok(long.length <= 64 && long.startsWith("clip-review:"), long);
  });

  it("reports rejected or timed-out reviews with the stage that stopped", () => {
    const rejected1 = sign("Sign clip status (HMAC)", { "Wait for rater 1 (≤ 48 h)": { body: { decision: "reject", rater_id: "usr_r1" } } });
    assert.deepEqual([rejected1.json["status"], rejected1.json["stage"]], ["rejected", "rater_1"]);
    // Exactly api/openapi.yaml ClipReviewOutcome (additionalProperties: false).
    assert.deepEqual(Object.keys(rejected1.json).sort(), ["n8n_execution_id", "stage", "status"]);
    const timeout2 = sign("Sign clip status (HMAC)", {
      "Wait for rater 1 (≤ 48 h)": { body: { decision: "windows_set" } },
      "Wait for rater 2 (≤ 48 h)": {},
    });
    assert.deepEqual([timeout2.json["status"], timeout2.json["stage"]], ["review_timeout", "rater_2"]);
  });

  it("has no rule logic in Code nodes and keeps executions for audit", () => {
    for (const n of wf.nodes.filter((x) => x.type === "n8n-nodes-base.code")) {
      assert.doesNotMatch(n.parameters["jsCode"] as string, /kappa|agreement\s*=|threshold/i, n.name);
    }
    assert.equal(wf.settings["saveDataSuccessExecution"], "all");
    assert.equal(wf.meta?.margdarshak?.workflow_id, "W08");
  });
});

describe("W14 field-test capture (F-57, D-22)", () => {
  const wf = byPrefix("W14-");
  const envelope = (payload: string, ts: number, secret = SECRET) => ({
    ts: String(ts),
    payload,
    sig: `sha256=${createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex")}`,
  });
  const verifyCode = node(wf, "Verify envelope (HMAC)").parameters["jsCode"] as string;
  const columnsCode = node(wf, "Keep sheet columns only (no PII)").parameters["jsCode"] as string;
  const event = {
    event: "session_end",
    event_id: "evt_01JBSESSIONEND01",
    cohort: "field_test",
    participant_code: "P-042",
    game: "nazar",
    session_id: "gs_01JB8Z0001",
    score: 61,
    latency_ms: 840,
    calibration: { n: 12, brier: 0.18, overconfidence: 0.04 },
    server_checked: true,
    verified_at: "2026-10-24T10:15:00Z",
  };
  const columns = (payload: unknown) => runCode(columnsCode, { $: nodeAccessor({ "Verify envelope (HMAC)": { payload } }) });

  it("receives md/session-end behind header auth and verifies the envelope before any work", () => {
    const hook = node(wf, "Session end (from API)");
    assert.equal(hook.parameters["path"], "md/session-end");
    assert.equal(hook.parameters["authentication"], "headerAuth");
    assert.deepEqual(outgoing(wf, hook.name), [["Verify envelope (HMAC)"]]);
    const run = (body: unknown) => runCode(verifyCode, { $json: { body }, $vars: { MD_HMAC_SECRET: SECRET } })[0]!.json;
    const p = JSON.stringify(event);
    assert.equal(run(envelope(p, nowS()))["valid"], true);
    assert.equal(run({ ...envelope(p, nowS()), payload: p.replace("P-042", "P-043") })["reason"], "bad_signature");
    assert.equal(run(envelope(p, nowS() - 301))["reason"], "stale");
    assert.equal(run(envelope(p, nowS(), "other"))["valid"], false);
  });

  it("writes only whitelisted, pseudonymous columns (no names or contact details)", () => {
    const [row] = columns({ ...event, name: "Asha K", phone: "+910000000000", email: "a@example.invalid", near_miss_text: "free text" });
    const j = row!.json;
    assert.deepEqual(Object.keys(j).sort(), [
      "calibration_brier",
      "calibration_n",
      "calibration_overconfidence",
      "event_id",
      "game",
      "latency_ms",
      "participant_code",
      "received_at",
      "score",
      "server_checked",
      "session_id",
      "verified_at",
    ]);
    assert.deepEqual([j["participant_code"], j["score"], j["latency_ms"], j["calibration_brier"], j["server_checked"]], ["P-042", 61, 840, 0.18, true]);
    assert.doesNotMatch(JSON.stringify(j), /Asha|\+91|example\.invalid|free text/);
    assert.equal(columns({ ...event, cohort: "public" }).length, 0, "only the field_test cohort reaches the sheet");
    assert.throws(() => columns({ ...event, participant_code: "Asha K" }), /bad participant_code/);
    assert.throws(() => columns({ ...event, event_id: "x" }), /bad event_id/);
  });

  it("appends to the sheet idempotently by event_id, with the credential referenced by name", () => {
    const sheet = node(wf, "Append to field-study sheet");
    assert.equal(sheet.type, "n8n-nodes-base.googleSheets");
    assert.equal(sheet.parameters["operation"], "appendOrUpdate");
    assert.deepEqual((sheet.parameters["columns"] as { matchingColumns: string[] }).matchingColumns, ["event_id"]);
    assert.deepEqual(sheet.credentials, { googleSheetsOAuth2Api: { id: "REPLACE_ON_IMPORT", name: "Margdarshak field-study sheet" } });
    assert.equal(wf.settings["saveDataSuccessExecution"], "none", "keep participant rows out of execution logs");
  });

  it("hourly: starts nightly_stats through API-67 (signed), reads /v1/stats/public and posts a summary", () => {
    const sched = node(wf, "Every hour");
    assert.equal((sched.parameters["rule"] as { interval: { expression: string }[] }).interval[0]!.expression, "0 0 * * * *");
    assertSignedPosts(wf, [/^=\{\{ \$vars\.MD_API_BASE \}\}\/internal\/jobs\/nightly_stats$/]);
    const [out] = runCode(node(wf, "Build + sign nightly_stats request (HMAC)").parameters["jsCode"] as string, {
      $now: luxonLikeNow("2026-10-24T15"),
      $vars: { MD_HMAC_SECRET: SECRET },
    });
    const j = out!.json as { body: string; signature: string; idempotency_key: string };
    assert.equal(verify(SECRET, j.signature, j.body, nowS()).ok, true);
    assert.deepEqual(JSON.parse(j.body), { args: { stats_id: "stats-2026-10-24T15" } });
    assert.equal(j.idempotency_key, "nightly-stats:2026-10-24T15");
    assert.equal(node(wf, "GET /v1/stats/public").parameters["url"], "={{ $vars.MD_API_BASE }}/v1/stats/public");
    assert.deepEqual(outgoing(wf, "nightly_stats: result")[0], ["GET /v1/stats/public"]);
    assert.deepEqual(outgoing(wf, "Format summary"), [["Post to team channel"]]);
    assert.equal(node(wf, "Post to team channel").type, "n8n-nodes-base.slack");
    assert.ok(!wf.nodes.some((n) => /postgres|mysql|sql/i.test(n.type)));
  });

  it("formats the summary from API-71 numbers only", () => {
    const code = node(wf, "Format summary").parameters["jsCode"] as string;
    const stats = {
      as_of: "2026-10-24T15:00:00Z",
      nazar: { participants: 43, below_kerala_60_pct: 0.51, r_ll_quiz_vs_nazar: 0.12, r_ci95: [-0.18, 0.4], sample: "convenience" },
      journey_test: { participants: 6 },
      counters: { plans_computed: 311, game_sessions_counted: 1294 },
    };
    const [out] = runCode(code, { $json: stats, $: nodeAccessor({ "API-67 start nightly_stats": { body: { run_id: "trn-abc" } } }) });
    const text = out!.json["slack_text"] as string;
    assert.match(text, /Nazar participants: 43 · below 60\/100: 51% · r\(LL quiz, Nazar\) = 0\.12 \(95% CI -0\.18 to 0\.4\)/);
    assert.match(text, /trn-abc/);
    assert.doesNotMatch(text, /official|verified licence|safe driver/i);
  });
});
