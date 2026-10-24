import type { Case } from "./api-types";

/**
 * Payment state of a case (API-19 / API-24, EC-09), read from the server case only: the gateway's
 * signed callback moves the case (payment_confirmed -> LL_TEST, payment_pending -> PAYMENT_PENDING).
 * The `?payment=` the gateway page appends on the way back is a hint for what to say while the
 * case is re-read, never the proof.
 */
export type PaymentStatus = "paid" | "pending" | "none";

export function paymentStatus(c: Pick<Case, "state" | "key_dates"> | null): PaymentStatus {
  if (!c) return "none";
  if (c.state === "PAYMENT_PENDING") return "pending";
  if (c.key_dates?.["payment_confirmed_on"]) return "paid";
  return "none";
}

export type ReturnHint = "success" | "pending" | "failed";

/** `?payment=success|pending|failed&ref=pay_…` from the gateway's redirect back to the fee page. */
export function paymentReturn(search: string): { hint: ReturnHint; ref: string | null } | null {
  const q = new URLSearchParams(search);
  const hint = q.get("payment");
  if (hint !== "success" && hint !== "pending" && hint !== "failed") return null;
  const ref = q.get("ref");
  return { hint, ref: ref && /^pay_[0-9A-Za-z]{6,40}$/.test(ref) ? ref : null };
}
