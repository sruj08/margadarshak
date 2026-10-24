// RFC 9457 problem details, JSON responses and structured logs. Logs never include request bodies,
// signatures or secrets: only method, path, status, timing and the session's game and ID.
import type { ServerResponse } from "node:http";

export const PROBLEM_BASE = "https://margdarshak.example/problems/";

export interface Problem {
  /** Slug appended to PROBLEM_BASE, e.g. "unauthorized". */
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** Machine-readable code (ReplayError codes, signature failure reasons). */
  code?: string;
  /** Validation issues: path and message only, never the submitted values. */
  errors?: { path: string; message: string }[];
}

/** Thrown by route handlers; the server maps it to problem+json. */
export class HttpProblem extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(problem.title);
    this.problem = problem;
  }
}

/** Zod issues as problem `errors`: path and message only, never the submitted values. */
export function issueList(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): { path: string; message: string }[] {
  return issues
    .slice(0, 20)
    .map((i) => ({ path: i.path.map(String).join("."), message: i.message }));
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(text)),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}

export function sendProblem(
  res: ServerResponse,
  p: Problem,
  instance?: string,
  headers: Record<string, string> = {},
): void {
  const body: Record<string, unknown> = {
    type: `${PROBLEM_BASE}${p.type}`,
    title: p.title,
    status: p.status,
  };
  if (p.detail !== undefined) body["detail"] = p.detail;
  if (instance !== undefined) body["instance"] = instance;
  if (p.code !== undefined) body["code"] = p.code;
  if (p.errors !== undefined) body["errors"] = p.errors;
  const text = JSON.stringify(body);
  res.writeHead(p.status, {
    "content-type": "application/problem+json; charset=utf-8",
    "content-length": String(Buffer.byteLength(text)),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(text);
}

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/** One JSON object per line on stdout (Render and Kubernetes collect stdout). */
export function jsonLogger(write: (line: string) => void = (l) => process.stdout.write(l)): Logger {
  const emit = (level: string, msg: string, fields: LogFields = {}): void => {
    const rec: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      svc: "score-verifier",
      msg,
    };
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) rec[k] = v;
    write(`${JSON.stringify(rec)}\n`);
  };
  return {
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
