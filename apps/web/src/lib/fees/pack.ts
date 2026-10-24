import feesPack from "@rulepacks/fees.json";
import { computeTrustFees, type TrustFees } from "./trust-line";

/**
 * The fee pack, bundled at build time from rulepacks/fees.json (no network, no literals).
 * A rule-pack change ships with a rebuild; the API (API-03) serves the same file at runtime.
 */
export function getTrustFees(): TrustFees | null {
  return computeTrustFees(feesPack);
}
