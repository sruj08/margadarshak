import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { magicLinkRedirect } from "./magic-link";

describe("e-mailed sign-in link (/auth/magic)", () => {
  it("redirects to the locale sign-in screen and keeps the code", () => {
    const req = new NextRequest("http://localhost/auth/magic?code=abc123", {
      headers: { cookie: "NEXT_LOCALE=hi" },
    });
    const res = magicLinkRedirect(req)!;
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/hi/signin?code=abc123");
  });
  it("ignores other paths", () => {
    expect(magicLinkRedirect(new NextRequest("http://localhost/en/plan"))).toBeNull();
  });
  it("defaults to English", () => {
    const res = magicLinkRedirect(new NextRequest("http://localhost/auth/magic?code=x"))!;
    expect(res.headers.get("location")).toBe("http://localhost/en/signin?code=x");
  });
});
