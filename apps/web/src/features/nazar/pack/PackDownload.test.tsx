// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClipPage } from "@/features/games/api-types";
import { IntlWrap } from "@/features/games/test-utils";
import { approxMb, PackDownload } from "./PackDownload";

afterEach(cleanup);

const page: ClipPage = {
  manifest_version: "x",
  total_bytes: 3_460_000,
  items: ["KL-0001", "KL-0002"].map((id) => ({
    item_ref: `clip:${id}@1`,
    clip_id: id,
    version: 1,
    duration_ms: 45000,
    tenant_tags: ["KL"],
    licence: "CC-BY-4.0" as const,
    attribution: "x",
    media: [
      {
        res: "360p" as const,
        bytes: 1_730_000,
        sha256: "a".repeat(64),
        url: `https://m.example/${id}.mp4`,
      },
    ],
    total_bytes: 1_730_000,
    mock_eligible: false,
  })),
};

function fakeCaches() {
  const store = new Map<string, Response>();
  const cache = {
    match: async (u: string) => store.get(u),
    put: async (u: string, r: Response) => void store.set(u, r),
    delete: async (u: string) => store.delete(u),
  };
  return {
    store,
    caches: {
      open: async () => cache,
      has: async () => store.size > 0,
      delete: async () => true,
    } as unknown as CacheStorage,
  };
}

describe("PackDownload (size shown before any download; DP: no silent download)", () => {
  it("shows ≈ N MB first and downloads only after the confirm tap", async () => {
    const { caches, store } = fakeCaches();
    const fetchSpy = vi.fn(async () => new Response(new Uint8Array(10), { status: 200 }));
    render(
      <IntlWrap>
        <PackDownload
          load={async () => page}
          deps={{ caches, fetch: fetchSpy as unknown as typeof fetch }}
        />
      </IntlWrap>,
    );
    const button = await screen.findByTestId("pack-download");
    expect(button.textContent).toBe(`Download practice pack (≈ ${approxMb(3_460_000)} MB)`);
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(button);
    const confirm = await screen.findByTestId("pack-confirm");
    expect(fetchSpy).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(screen.getByTestId("pack-saved")).toBeTruthy());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(2);
  });

  it("says so honestly when no clip media is published (mock mode)", async () => {
    render(
      <IntlWrap>
        <PackDownload load={async () => ({ ...page, items: [], total_bytes: 0 })} />
      </IntlWrap>,
    );
    expect((await screen.findByTestId("pack-empty")).textContent).toContain("isn't published");
  });

  it("approxMb rounds like the spec's '≈ 38 MB'", () => {
    expect(approxMb(3_460_000)).toBe("3.3");
    expect(approxMb(40_000_000)).toBe("38");
  });
});
