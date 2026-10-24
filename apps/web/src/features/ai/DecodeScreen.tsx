"use client";

import { Fieldset, Input, Label } from "@heroui/react";
import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { decodeScreenshot, type ScreenDecode } from "./api";
import { type Box, type Prepared, prepareImage, render } from "./image";

/** The decoder catalogue's screens as Sarathi prints them (content/catalogue/decoder.json). */
const SCREENS: { id: string; label: string }[] = [
  { id: "STG.UNDER_SCRUTINY", label: "Under scrutiny & processing at RTO level" },
  { id: "STG.PAYMENT_PENDING", label: "Payment pending" },
  { id: "STG.APPROVAL_OF_DL", label: "Approval of DL" },
  { id: "STG.DL_APPROVED_DISPATCH", label: "DL approved / dispatch" },
  { id: "STG.RECORD_TEST_RESULT", label: "Record test result" },
  { id: "STG.LL_ISSUED", label: "Learner licence issued" },
  { id: "ERR.SESSION_EXPIRED", label: "Session expired" },
  { id: "ERR.FORBIDDEN_403", label: "Error 403 forbidden" },
  { id: "ERR.STATE_SESSION_LOST", label: "Unable to process your request (select your state)" },
  { id: "ERR.RELOAD_DETECTED", label: "Reload detected" },
  { id: "ERR.LLR_NOT_FOUND", label: "LLR details not found" },
  { id: "ERR.DETAILS_NOT_FOUND_BACKLOG", label: "My details are not found" },
  { id: "ERR.UPLOAD_FORMAT", label: "Invalid file format" },
  { id: "ERR.UPLOAD_SIZE", label: "File size exceeds the limit" },
  { id: "ERR.OTP_NOT_RECEIVED", label: "OTP not received" },
  { id: "ERR.LLTEST_PASSWORD", label: "LL test password not received" },
];

const humanise = (key: string) => key.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

/**
 * Screenshot decoder (MD-319, API-42). The preview is always shown and is exactly what will be
 * sent; the user covers personal data by tapping (number-like text found on the device is covered
 * already). Cancel sends nothing. The server only matches the picture to a closed list; when it
 * can't, or AI is off, the manual list is the answer (EC-29).
 */
export function DecodeScreen() {
  const t = useTranslations("ai.decode");
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScreenDecode | null>(null);
  const [notice, setNotice] = useState<"consent" | "off" | "unknown" | "scam" | null>(null);
  const [manual, setManual] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !prep) return;
    c.width = prep.width;
    c.height = prep.height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(prep.bitmap, 0, 0);
    ctx.fillStyle = "#000";
    for (const b of boxes) ctx.fillRect(b.x, b.y, b.w, b.h);
  }, [prep, boxes]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    setNotice(null);
    setManual(false);
    const p = await prepareImage(file);
    setPrep(p);
    setBoxes(p.autoBoxes);
  };

  const cover = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!prep) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * prep.width;
    const y = ((e.clientY - r.top) / r.height) * prep.height;
    const w = prep.width * 0.3;
    const h = prep.height * 0.06;
    setBoxes((b) => [...b, { x: x - w / 2, y: y - h / 2, w, h }]);
  };

  const send = async () => {
    if (!prep) return;
    setBusy(true);
    const res = await decodeScreenshot(await render(prep, boxes), prep.ocrText);
    setBusy(false);
    setPrep(null);
    if (!res.ok) {
      setNotice(res.code === "CONSENT_REQUIRED" ? "consent" : "off");
      setManual(true);
      return;
    }
    setResult(res.data);
    if (res.data.catalogue_id === "UNKNOWN") {
      const scam = res.data.next_steps?.some((s) => s.step_key === "open_scam_check");
      setNotice(scam ? "scam" : "unknown");
      setManual(!scam);
    }
  };

  return (
    <div className="md-page md-stack" data-testid="decode-screen">
      <h1 className="md-h1">{t("title")}</h1>
      <p>{t("intro")}</p>
      <Banner tone="info" title={t("privacyTitle")}>
        {t("privacy")}
      </Banner>
      <Label className="md-field__label" htmlFor="decode-file">
        {t("pick")}
      </Label>
      <Input
        id="decode-file"
        type="file"
        accept="image/*"
        className="mj-input"
        onChange={(e) => void pick(e.target.files?.[0])}
        data-testid="decode-file"
      />

      {prep ? (
        <section aria-label={t("preview")}>
          <p>{t("preview")}</p>
          <canvas
            ref={canvas}
            onClick={cover}
            style={{
              maxWidth: "100%",
              border: "1px solid var(--md-border, #ccc)",
              cursor: "crosshair",
            }}
            data-testid="decode-preview"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Button
              variant="primary"
              isPending={busy}
              onPress={() => void send()}
              data-testid="decode-send"
            >
              {t("send")}
            </Button>
            <Button variant="secondary" onPress={() => setPrep(null)}>
              {t("cancel")}
            </Button>
          </div>
        </section>
      ) : null}
      {busy ? <p role="status">{t("working")}</p> : null}

      {notice ? (
        <Banner tone={notice === "scam" ? "caution" : "info"} title={t(notice)} role="status">
          {notice === "scam" ? null : t("manual")}
        </Banner>
      ) : null}

      {result && result.catalogue_id !== "UNKNOWN" && !chosen ? (
        <section className="mj-card mj-card--soft" data-testid="decode-result">
          <p>{t("result")}</p>
          <p>
            <strong>
              {SCREENS.find((s) => s.id === result.catalogue_id)?.label ?? result.catalogue_id}
            </strong>
          </p>
          {result.remark_raw ? (
            <p className="mj-caption">
              {t("remark")}: “{result.remark_raw}”
            </p>
          ) : null}
          <p>{t("confirm")}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="primary" onPress={() => setChosen(result.catalogue_id)}>
              {t("yes")}
            </Button>
            <Button variant="secondary" onPress={() => setManual(true)}>
              {t("no")}
            </Button>
          </div>
        </section>
      ) : null}

      {manual && !chosen ? (
        <Fieldset className="mj-input-group" data-testid="decode-manual">
          <Fieldset.Legend className="md-field__label">{t("manual")}</Fieldset.Legend>
          {SCREENS.map((s) => (
            <Button key={s.id} variant="secondary" onPress={() => setChosen(s.id)}>
              {s.label}
            </Button>
          ))}
        </Fieldset>
      ) : null}

      {chosen ? (
        <section className="mj-card" data-testid="decode-steps">
          <h2 className="md-h3">{t("steps")}</h2>
          <p>
            <strong>{SCREENS.find((s) => s.id === chosen)?.label ?? chosen}</strong>
          </p>
          {result?.catalogue_id === chosen ? (
            <ol>
              {(result.next_steps ?? []).map((s) => (
                <li key={s.step_key}>{humanise(s.step_key ?? "")}</li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
