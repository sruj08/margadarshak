/**
 * snake_case (wire) -> camelCase (UI) mapper, typed (PROJECT_BRIEF §15 "JSON casing").
 * Only keys change; values (including paise integers and ISO dates) are untouched.
 */

type CamelCase<S extends string> = S extends `${infer Head}_${infer Tail}`
  ? `${Head}${Capitalize<CamelCase<Tail>>}`
  : S;

export type Camelized<T> = T extends readonly (infer U)[]
  ? Camelized<U>[]
  : T extends Date
    ? T
    : T extends object
      ? { [K in keyof T as K extends string ? CamelCase<K> : K]: Camelized<T[K]> }
      : T;

export function camelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function toCamel<T>(value: T): Camelized<T> {
  if (Array.isArray(value)) return value.map((v) => toCamel(v)) as Camelized<T>;
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[camelKey(k)] = toCamel(v);
    return out as Camelized<T>;
  }
  return value as Camelized<T>;
}
