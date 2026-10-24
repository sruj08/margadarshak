// Dev helper: prints every golden vector's scored result, to review expected results by hand.
//   node --experimental-strip-types scripts/print-vectors.ts [name-prefix]
import { allVectorInputs } from "../src/fixtures/vectors.ts";
import { replay } from "../src/scoring/index.ts";

const only = process.argv[2];
for (const v of allVectorInputs()) {
  if (only !== undefined && !v.name.startsWith(only)) continue;
  const r = replay(v.manifest, v.ctx, v.replayPackage, v.content);
  const comps = r.score.components.map((c) => `${c.id}:${c.value}/${c.max}`).join(" ");
  process.stdout.write(
    `${v.name} raw=${r.score.raw}/${r.score.max} pct=${r.score.pct} passed=${r.score.passed} ` +
      `cap=${r.score.capApplied} flags=${r.integrity.flags.join("|")} trust=${r.integrity.trust}\n   ${comps}\n`,
  );
  for (const f of r.findings) {
    process.stdout.write(
      `   ${f.findingId} sev=${f.severity} crit=${f.critical} ${JSON.stringify(f.facts)} ${f.drillIds.join(",")}\n`,
    );
  }
  if (r.evidence.length > 0) {
    const ev = r.evidence
      .map((e) => `${e.cardId}:${e.rating}${e.overconfident ? "!" : ""}`)
      .join(" ");
    process.stdout.write(`   evidence=${ev}\n`);
  }
  if (r.calibration !== null)
    process.stdout.write(`   calibration=${JSON.stringify(r.calibration)}\n`);
}
