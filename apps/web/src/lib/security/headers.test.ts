import { describe, expect, it } from "vitest";
import { buildCsp, mediaOrigin, securityHeaders } from "./headers";

describe("security headers (MD-025)", () => {
  it("ships CSP, HSTS, Referrer-Policy and Permissions-Policy", () => {
    const keys = securityHeaders({ isDev: false }).map((h) => h.key);
    for (const k of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(keys).toContain(k);
    }
  });

  it("allows no third-party script, style or font origin", () => {
    const csp = buildCsp({ isDev: false, connect: ["https://api.example.in/v1"] });
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self' https://api.example.in");
    expect(csp).not.toMatch(/googletagmanager|google-analytics|fonts\.googleapis/);
  });

  it("ignores malformed connect origins and allows HMR only in dev", () => {
    expect(buildCsp({ isDev: false, connect: ["not a url"] })).toContain("connect-src 'self';");
    expect(buildCsp({ isDev: true })).toContain("'unsafe-eval'");
  });

  it("allows the clip media host for playback, posters and preloads, and blob: playback", () => {
    const csp = buildCsp({ isDev: false, media: ["media.example.in"] });
    expect(csp).toContain("media-src 'self' blob: https://media.example.in;");
    expect(csp).toContain("img-src 'self' data: blob: https://media.example.in;");
    expect(csp).toContain("connect-src 'self' https://media.example.in;");
    expect(buildCsp({ isDev: false })).toContain("media-src 'self' blob:;");
    expect(mediaOrigin("https://cdn.example.in/clips/")).toBe("https://cdn.example.in");
    expect(mediaOrigin("http://localhost:8080")).toBe("http://localhost:8080");
    expect(mediaOrigin("")).toBeNull();
    expect(buildCsp({ isDev: false, media: ["not a host!"] })).toContain("media-src 'self' blob:;");
  });

  it("denies camera and microphone until a route needs them", () => {
    const pp = securityHeaders({ isDev: false }).find((h) => h.key === "Permissions-Policy");
    expect(pp?.value).toContain("camera=()");
    expect(pp?.value).toContain("microphone=()");
  });
});
