/** Joins class names, skipping falsy values. Tiny on purpose (no clsx dependency). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  let out = "";
  for (const part of parts) {
    if (part) out = out ? `${out} ${part}` : part;
  }
  return out;
}
