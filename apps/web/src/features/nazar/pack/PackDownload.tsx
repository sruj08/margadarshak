"use client";

import { Button } from "@margdarshak/ui/components/button";
import { Sheet } from "@margdarshak/ui/components/sheet";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { listNazarClips } from "@/features/games/api";
import { type ClipPage, PACK_RESOLUTION } from "@/features/games/api-types";
import {
  type ClipPackDeps,
  clipPackStatus,
  clipPacksSupported,
  downloadClipPack,
  removeClipPack,
} from "@/lib/offline/clip-pack";

/** "≈ N MB" from bytes, one decimal under 10 MB (the size is shown before any download). */
export function approxMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 10 ? (Math.round(mb * 10) / 10).toString() : Math.round(mb).toString();
}

/**
 * The pack rendition URL of each clip (API-37 lists only the requested resolution, so this is
 * normally the clip's single `media` entry).
 */
export const packUrls = (page: ClipPage): string[] =>
  page.items.flatMap((i) =>
    i.media
      .filter((m) => m.res === PACK_RESOLUTION)
      .map((m) => m.url)
      .slice(0, 1),
  );

export const packBytes = (page: ClipPage): number =>
  page.total_bytes ?? page.items.reduce((s, i) => s + i.total_bytes, 0);

const defaultLoad = () => listNazarClips({});

type State =
  | { k: "loading" }
  | { k: "error" }
  | { k: "empty" }
  | { k: "unsupported" }
  | { k: "ready"; page: ClipPage; cached: boolean }
  | { k: "downloading"; page: ClipPage; done: number; total: number }
  | { k: "failed"; page: ClipPage };

/**
 * Offline practice pack (FRONTEND §8.2–8.3, EC-19, DP: no silent download). The size from API-37
 * `total_bytes` is on the button before anything is fetched, and a sheet confirms it again; the
 * download runs only from that tap (`userAction: true`). Remove sits next to it. With no published
 * clip media (mock mode today) it says so instead of offering anything.
 */
export function PackDownload({
  load = defaultLoad,
  deps,
}: {
  load?: () => Promise<ClipPage | null>;
  deps?: ClipPackDeps;
}) {
  const t = useTranslations("nazar");
  const [state, setState] = useState<State>({ k: "loading" });
  const [confirm, setConfirm] = useState(false);

  const refresh = useCallback(async () => {
    setState({ k: "loading" });
    try {
      const page = await load();
      if (!page) return setState({ k: "error" });
      const urls = packUrls(page);
      if (urls.length === 0) return setState({ k: "empty" });
      if (!clipPacksSupported(deps ?? {})) return setState({ k: "unsupported" });
      const status = await clipPackStatus(urls, deps ?? {});
      setState({ k: "ready", page, cached: status.complete });
    } catch {
      setState({ k: "error" });
    }
  }, [load, deps]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const start = async (page: ClipPage) => {
    setConfirm(false);
    const urls = packUrls(page);
    setState({ k: "downloading", page, done: 0, total: urls.length });
    try {
      await downloadClipPack({
        urls,
        userAction: true,
        ...(deps ?? {}),
        onProgress: (p) => setState({ k: "downloading", page, done: p.done, total: p.total }),
      });
      setState({ k: "ready", page, cached: true });
    } catch {
      setState({ k: "failed", page });
    }
  };

  const remove = async (page: ClipPage) => {
    await removeClipPack(packUrls(page), deps ?? {});
    setState({ k: "ready", page, cached: false });
  };

  return (
    <section className="mg-pack" aria-labelledby="pack-h" data-testid="pack">
      <h2 id="pack-h" className="md-h3">
        {t("pack.title")}
      </h2>
      {state.k === "loading" ? (
        <p aria-busy="true" data-testid="pack-loading">
          {t("pack.checking")}
        </p>
      ) : null}
      {state.k === "error" ? (
        <p>
          {t("pack.error")}{" "}
          <Button variant="ghost" onPress={() => void refresh()}>
            {t("pack.retry")}
          </Button>
        </p>
      ) : null}
      {state.k === "empty" ? <p data-testid="pack-empty">{t("pack.empty")}</p> : null}
      {state.k === "unsupported" ? <p>{t("pack.unsupported")}</p> : null}
      {state.k === "ready" && !state.cached ? (
        <Button variant="secondary" onPress={() => setConfirm(true)} data-testid="pack-download">
          {t("pack.download", { mb: approxMb(packBytes(state.page)) })}
        </Button>
      ) : null}
      {state.k === "ready" && state.cached ? (
        <p data-testid="pack-saved">
          {t("pack.saved", { mb: approxMb(packBytes(state.page)) })}{" "}
          <Button variant="ghost" onPress={() => void remove(state.page)}>
            {t("pack.remove")}
          </Button>
        </p>
      ) : null}
      {state.k === "downloading" ? (
        <p role="status" data-testid="pack-progress">
          {t("pack.progress", { done: state.done, total: state.total })}
        </p>
      ) : null}
      {state.k === "failed" ? (
        <p role="alert">
          {t("pack.failed")}{" "}
          <Button variant="ghost" onPress={() => setConfirm(true)}>
            {t("pack.retry")}
          </Button>
        </p>
      ) : null}
      {state.k === "ready" || state.k === "failed" ? (
        <Sheet
          isOpen={confirm}
          onOpenChange={setConfirm}
          title={t("pack.confirmTitle", { mb: approxMb(packBytes(state.page)) })}
          description={t("pack.confirmBody")}
          closeLabel={t("pack.notNow")}
        >
          <div className="mg-sheet-actions">
            <Button
              variant="primary"
              size="lg"
              onPress={() => void start(state.page)}
              data-testid="pack-confirm"
            >
              {t("pack.confirm", { mb: approxMb(packBytes(state.page)) })}
            </Button>
            <Button variant="ghost" onPress={() => setConfirm(false)}>
              {t("pack.notNow")}
            </Button>
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}
