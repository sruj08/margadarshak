// Unit tests of the TS mirror beyond the shared golden suite.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { PackFile, PackSources } from "../src/index.ts";
import {
  compileAll,
  compilePack,
  feeQuote,
  InputError,
  PackError,
  parseExpr,
  plan,
  todayIST,
} from "../src/index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const rp = join(root, "rulepacks");
const read = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));

function sources(): PackSources {
  const states: { [k: string]: PackFile } = {};
  for (const f of readdirSync(join(rp, "states")).filter((x) => x.endsWith(".json"))) {
    const pf = read(join(rp, "states", f)) as PackFile;
    states[pf.packId] = pf;
  }
  return {
    base: read(join(rp, "base", "cmvr.json")) as PackSources["base"],
    states,
    fees: read(join(rp, "fees.json")) as PackSources["fees"],
    classes: read(join(rp, "classes.json")) as PackSources["classes"],
  };
}

describe("engine", () => {
  it("EC-28: Kerala HPT stayed switches the notice and drops the HPT step", () => {
    const src = sources();
    const kl = src.states["KL"] as PackFile;
    const hpt = kl.rules.find((r) => r.id === "KL-PRM-HPT");
    assert.ok(hpt);
    (hpt.output["value"] as { [k: string]: unknown })["status"] = "stayed";
    const p = plan(compileAll(src), {
      as_of: "2026-11-15",
      state: "KL",
      dob: "2000-01-01",
      vehicles: ["car"],
    });
    assert.equal(p.hpt.status, "stayed");
    assert.equal(p.hpt.applies, false);
    assert.ok(p.notices.some((n) => n.rule_id === "KL-NTC-HPT-STAYED"));
    assert.ok(!p.steps.some((s) => s.key === "dl.hpt"));
  });

  it("overlay precedence: state row wins, base row used when absent", () => {
    const packs = compileAll(sources());
    assert.equal(packs.get("JK")?.params.get("PRM-LL-FORMAT")?.id, "JK-PRM-LL-FORMAT");
    assert.equal(packs.get("DL")?.params.get("PRM-LL-FORMAT")?.id, "PRM-LL-FORMAT");
    assert.notEqual(packs.get("JK")?.hash, packs.get("DL")?.hash);
  });

  it("fees: 1/2/3 classes = 90000 / 135000 / 180000 paise", () => {
    const jk = compileAll(sources()).get("JK");
    assert.ok(jk);
    assert.equal(feeQuote(jk, ["LMV-NT"]).total_paise, 90000);
    assert.equal(feeQuote(jk, ["MCWG", "LMV-NT"]).total_paise, 135000);
    assert.equal(feeQuote(jk, ["MCWOG", "MCWG", "LMV-NT"]).subtotal_govt_fee_paise, 160000);
  });

  it("rejects unknown operators, facts and params at compile time", () => {
    assert.throws(() => parseExpr({ eval: "1+1" }, 1));
    assert.throws(() => parseExpr({ fact: "aadhaarNumber" }, 1));
    assert.throws(() => parseExpr({ eq: [1.5, 1] }, 1));
    const src = sources();
    const kl = src.states["KL"] as PackFile;
    const row = kl.rules.find((r) => r.id === "KL-NTC-HPT-STAYED");
    assert.ok(row);
    row.condition = { in: [{ param: { id: "PRM-NOPE", path: "status" } }, ["stayed"]] };
    assert.throws(() => compilePack(src, "KL"), PackError);
  });

  it("input errors carry stable codes", () => {
    const packs = compileAll(sources());
    assert.throws(
      () =>
        plan(packs, {
          as_of: "2026-10-23",
          state: "JK",
          dob: "2000-01-01",
          vehicles: ["spaceship"],
        }),
      (e: unknown) => e instanceof InputError && e.code === "UNKNOWN_VEHICLE",
    );
  });

  it("todayIST uses IST date boundaries (EC-15)", () => {
    assert.equal(todayIST(new Date("2026-10-23T20:00:00Z")), "2026-10-24");
    assert.equal(todayIST(new Date("2026-10-23T18:29:59Z")), "2026-10-23");
  });
});
