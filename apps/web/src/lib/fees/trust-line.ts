/**
 * Calm trust line (MD-024, F-01, D-06). Both numbers come from rulepacks/fees.json (CMVR r.32), in
 * integer paise, and are never typed into copy:
 *   one class = every `per: "class"` item once + every `per: "application"` item, minus the smart card
 *   card      = the smart-card item(s)
 * The parser tolerates the pack's casing (camelCase in the pack, snake_case on the API) and returns
 * null rather than a guess when the pack is unusable; the UI then hides the numbers (SCR-003 error state).
 */

export type Confidence = "high" | "medium" | "low";

export interface TrustSource {
  /** Short chip label, e.g. "CMVR r.32". */
  short: string;
  title: string;
  url: string | null;
  /** ISO date (IST calendar date) of the oldest check behind the numbers. */
  checkedOn: string;
  confidence: Confidence;
}

export interface TrustFees {
  oneClassPaise: number;
  cardPaise: number;
  source: TrustSource;
  packVersion: string | null;
}

type Row = Record<string, unknown>;

function isRow(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(row: Row, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function amountOf(row: Row): number | null {
  const v = row["amount"] ?? row["amount_paise"] ?? row["amountPaise"];
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

function isSmartCard(row: Row): boolean {
  if (row["smartCard"] === true || row["smart_card"] === true) return true;
  const id = str(row, "id") ?? "";
  const label = str(row, "labelKey", "label_key") ?? "";
  return /SMART-?CARD/i.test(id) || /smart_card$/.test(label);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

function asConfidence(v: string | null): Confidence | null {
  return v === "high" || v === "medium" || v === "low" ? v : null;
}

/** "CMVR 1989 r.32 (revised table ...)" -> "CMVR r.32". */
export function shortSource(title: string): string {
  const m = /\bCMVR\b[^,;:]*?\br\.?\s?(\d+)/i.exec(title);
  if (m) return `CMVR r.${m[1]}`;
  return title.split(/[(:,]/)[0]?.trim() || title;
}

export function computeTrustFees(pack: unknown): TrustFees | null {
  if (!isRow(pack)) return null;
  const unit = str(pack, "unit");
  if (unit !== null && unit !== "paise") return null;
  const items = pack["items"];
  if (!Array.isArray(items) || items.length === 0) return null;

  let oneClass = 0;
  let card = 0;
  let haveCard = false;
  let haveFee = false;
  let oldest: string | null = null;
  let weakest: Confidence = "high";
  let primary: Row | null = null;

  for (const raw of items) {
    if (!isRow(raw)) return null;
    if (raw["includedInTotal"] === false || raw["included_in_total"] === false) continue;
    const per = str(raw, "per");
    if (per !== "class" && per !== "application") continue;
    const amount = amountOf(raw);
    if (amount === null) return null;
    if (isSmartCard(raw)) {
      card += amount;
      haveCard = true;
    } else {
      oneClass += amount;
      haveFee = true;
      primary ??= raw;
    }
    const checked = str(raw, "checkedOn", "checked_on", "verified_on", "verifiedOn");
    if (checked && ISO_DATE.test(checked) && (oldest === null || checked < oldest))
      oldest = checked;
    const conf = asConfidence(str(raw, "confidence"));
    if (conf && RANK[conf] < RANK[weakest]) weakest = conf;
  }

  const packChecked = str(pack, "checkedOn", "verified_on", "verifiedOn");
  const checkedOn = oldest ?? (packChecked && ISO_DATE.test(packChecked) ? packChecked : null);
  if (!haveFee || !haveCard || checkedOn === null || primary === null) return null;

  const primarySource = primary["source"];
  const packSource = pack["source"];
  const src: Row = isRow(primarySource) ? primarySource : isRow(packSource) ? packSource : {};
  const title = str(src, "title") ?? "CMVR 1989 r.32";
  return {
    oneClassPaise: oneClass,
    cardPaise: card,
    source: {
      short: shortSource(title),
      title,
      url: str(src, "url"),
      checkedOn,
      confidence: weakest,
    },
    packVersion: str(pack, "version"),
  };
}
