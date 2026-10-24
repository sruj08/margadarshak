import { describe, expect, it } from "vitest";
import { toCamel } from "./case";
import { adapterProvenance, createApiClient, isProblem } from "./index";

describe("api client", () => {
  it("sends tenant, language, request id and an idempotency key on writes", async () => {
    const seen: Request[] = [];
    const client = createApiClient({
      baseUrl: "http://api.test/",
      tenant: "JK",
      locale: "hi",
      newId: () => "id-1",
      fetch: async (req) => {
        seen.push(req);
        return new Response(JSON.stringify({ status: "ok" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    await client.GET("/v1/health");
    const req = seen[0];
    expect(req?.url).toBe("http://api.test/v1/health");
    expect(req?.headers.get("X-Tenant")).toBe("JK");
    expect(req?.headers.get("Accept-Language")).toBe("hi");
    expect(req?.headers.get("X-Request-Id")).toBe("id-1");
    expect(req?.headers.get("Idempotency-Key")).toBeNull();
    expect(req?.headers.get("X-Requested-With")).toBeNull();
    await client.POST("/v1/me/consents", {
      body: { purpose: "ai_coach", action: "grant", notice_version: "n1" },
    });
    expect(seen[1]?.headers.get("Idempotency-Key")).toBe("id-1");
    expect(seen[1]?.headers.get("X-Requested-With")).toBe("margdarshak");
  });

  it("recognises RFC 9457 problems", () => {
    expect(isProblem({ type: "about:blank", title: "Not found", status: 404 })).toBe(true);
    expect(isProblem({ message: "nope" })).toBe(false);
  });

  it("reads adapter provenance from a response", () => {
    expect(adapterProvenance({ adapter: "mock" })).toEqual({
      adapterMode: "mock",
      simulated: true,
    });
    expect(adapterProvenance({ adapter: "deeplink", simulated: false })).toEqual({
      adapterMode: "deeplink",
      simulated: false,
    });
    expect(adapterProvenance(null)).toEqual({ adapterMode: null, simulated: false });
  });

  it("maps snake_case to camelCase without touching values", () => {
    const out = toCamel({ amount_paise: 70000, line_items: [{ rule_id: "FEE-LL-ISSUE" }] });
    expect(out).toEqual({ amountPaise: 70000, lineItems: [{ ruleId: "FEE-LL-ISSUE" }] });
    expect(out.lineItems[0]?.ruleId).toBe("FEE-LL-ISSUE");
  });
});
