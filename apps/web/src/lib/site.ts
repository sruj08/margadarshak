/** Site-wide constants. Nothing here is a fee, a rule date, or any fact the user is told as law. */

/** Page-level "last updated" date shown in the footer (GIGW 3.0). Bump on each content release. */
export const SITE_UPDATED = "2026-10-23";

/**
 * Grievance officer contact (IT Rules 2021 Rule 3(2), DPDP Rules Rule 9). The launch domain is not
 * registered yet, so the address comes from env; the placeholder keeps the gap visible.
 */
export const GRIEVANCE_EMAIL =
  process.env["NEXT_PUBLIC_GRIEVANCE_EMAIL"] ?? "grievance@margdarshak.example";

/** The only government contact verified so far (PROJECT_BRIEF §15 "Helpline"). */
export const GOV_HELPDESK_EMAIL = "helpdesk-mparivahan@gov.in";
