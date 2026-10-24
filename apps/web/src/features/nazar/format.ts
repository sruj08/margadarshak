import kl from "@rulepacks/states/KL.json";

/**
 * Kerala's announced HPT format (NAZAR §8), read from the KL rule-pack row `KL-PRM-HPT` so every
 * number on screen comes from data with its source and check date (D-09, EC-28). These are
 * Kerala's numbers as reported, not ours; Nazar is practice, not Kerala's test.
 */
export interface KeralaFormat {
  clips: number;
  marksPerClip: number;
  passMark: number;
  totalMarks: number;
  /** announced | in_force | on_hold | stayed | postponed | withdrawn */
  status: string;
  effectiveFrom: string | null;
  checkedOn: string | null;
  sourceTitle: string;
  sourceUrl: string | null;
}

interface RuleRow {
  id: string;
  output?: { value?: Record<string, unknown> };
  source?: { title?: string; url?: string };
  checkedOn?: string;
}

export function keralaFormat(): KeralaFormat {
  const row = (kl.rules as RuleRow[]).find((r) => r.id === "KL-PRM-HPT");
  const v = row?.output?.value ?? {};
  const num = (k: string, d: number) => (typeof v[k] === "number" ? (v[k] as number) : d);
  const clips = num("clips", 10);
  const marksPerClip = num("marksPerClip", 10);
  return {
    clips,
    marksPerClip,
    passMark: num("passMark", 60),
    totalMarks: clips * marksPerClip,
    status: typeof v["status"] === "string" ? (v["status"] as string) : "announced",
    effectiveFrom: typeof v["effectiveFrom"] === "string" ? (v["effectiveFrom"] as string) : null,
    checkedOn: row?.checkedOn ?? null,
    sourceTitle: row?.source?.title ?? "",
    sourceUrl: row?.source?.url ?? null,
  };
}
