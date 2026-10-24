// Replays golden sessions and compares SHA-256 hashes of the canonical SessionResult (CICD
// `game-determinism` gate): `node dist/cli/replay.js [file]`.
//   - No argument: game-core's built-in golden vectors, through `replayAsync`.
//   - packages/game-core/fixtures/golden.json (`schema: margdarshak.game-core.golden/1`): every
//     vector's exact /verify request body goes through the verifier's own path (strict request
//     schema → content store with inline documents → replay → digest), against the built-in fixture
//     content, and must reproduce `expected.digest`.
//   - A JSON array of {name, manifest, ctx, replayPackage, content, expectedResult} (older format).
// One JSON line per vector; exit code 1 on any mismatch, 2 on an unreadable file.
import { readFileSync } from "node:fs";
import { type GoldenVector, goldenVectors } from "@margdarshak/game-core/fixtures";
import { replayAsync } from "@margdarshak/game-core/scoring";
import { canonicalDigest } from "@margdarshak/game-core/sdk";
import { FixtureContentStore } from "../content-store.ts";
import { VerifyRequest, verifySession } from "../verify.ts";

interface Line {
  name: string;
  ok: boolean;
  digest?: string;
  expected?: string;
  error?: string;
}

type Check = { name: string; run: () => Promise<{ got: string; want: string }> };

const GOLDEN_SCHEMA = "margdarshak.game-core.golden/1";

function fromVectors(vectors: readonly GoldenVector[]): Check[] {
  return vectors.map((v) => ({
    name: v.name,
    run: async () => ({
      got: canonicalDigest(await replayAsync(v.manifest, v.ctx, v.replayPackage, v.content)),
      want: canonicalDigest(v.expectedResult),
    }),
  }));
}

function fromGoldenFile(file: {
  vectors: { name: string; request: unknown; expected: { digest: string } }[];
}): Check[] {
  const store = new FixtureContentStore();
  return file.vectors.map((v) => ({
    name: v.name,
    run: async () => {
      const req = VerifyRequest.parse(v.request);
      const res = await verifySession(req, store);
      return { got: res.digest, want: v.expected.digest };
    },
  }));
}

function load(path: string | undefined): Check[] {
  if (path === undefined) return fromVectors(goldenVectors());
  const json: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(json)) return fromVectors(json as GoldenVector[]);
  const file = json as { schema?: unknown; vectors?: unknown };
  if (file.schema === GOLDEN_SCHEMA && Array.isArray(file.vectors)) {
    return fromGoldenFile(file as Parameters<typeof fromGoldenFile>[0]);
  }
  throw new Error(`${path}: neither a vector array nor a ${GOLDEN_SCHEMA} file`);
}

async function main(): Promise<number> {
  const checks = load(process.argv[2]);
  let failed = 0;
  for (const c of checks) {
    let line: Line;
    try {
      const { got, want } = await c.run();
      line = {
        name: c.name,
        ok: got === want,
        digest: got,
        ...(got === want ? {} : { expected: want }),
      };
    } catch (e) {
      line = { name: c.name, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (!line.ok) failed++;
    process.stdout.write(`${JSON.stringify(line)}\n`);
  }
  process.stdout.write(`${JSON.stringify({ total: checks.length, failed })}\n`);
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  },
);
