"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { EmptyState } from "@margdarshak/ui/components/empty-state";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { Camera, PenLine, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { BackLink } from "@/components/journey/status";
import { useRouter } from "@/i18n/navigation";
import { getActiveCase } from "@/lib/case/case-store";
import { writeDocs } from "@/lib/case/use-case-session";
import {
  type FixResult,
  fixImage,
  type ImageSpec,
  loadImage,
  PHOTO_SPEC,
  SIGNATURE_SPEC,
  safeFileName,
} from "@/lib/journey/image-fix";
import { recordScreen } from "@/lib/journey/trial-log";

type Mode = "photo" | "signature";
type Phase = "capture" | "pad" | "result" | "denied";

/**
 * Photo and signature fixer (SCR-035..037, MD-113, F-06). Camera guide or gallery upload, crop to
 * the size, background whitened (photo) or ink to black-on-white (signature), quality search to the
 * KB band, a safe file name. Everything runs on this phone; the file is saved to the phone and is
 * never uploaded to Margdarshak.
 */
export function ImageFixer({ mode }: { mode: Mode }) {
  const t = useTranslations("fixer");
  const tc = useTranslations("common");
  const router = useRouter();
  const spec: ImageSpec = mode === "photo" ? PHOTO_SPEC : SIGNATURE_SPEC;
  const videoRef = useRef<HTMLVideoElement>(null);
  const padRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("capture");
  const [cameraOn, setCameraOn] = useState(false);
  const [coach, setCoach] = useState<string>("");
  const [original, setOriginal] = useState<string | null>(null);
  const [result, setResult] = useState<FixResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    recordScreen(`apply.${mode}`);
  }, [mode]);

  const stop = useCallback(() => {
    for (const tr of streamRef.current?.getTracks() ?? []) tr.stop();
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => stop, [stop]);

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("denied");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode === "photo" ? "user" : "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraOn(true);
    } catch {
      setPhase("denied");
    }
  };

  // Live coaching from frame brightness (deterministic, on device), at most every 2 s.
  useEffect(() => {
    if (!cameraOn) return;
    const probe = document.createElement("canvas");
    probe.width = 32;
    probe.height = 32;
    const id = window.setInterval(() => {
      const v = videoRef.current;
      const ctx = probe.getContext("2d", { willReadFrequently: true });
      if (!v || !ctx || v.readyState < 2) return;
      ctx.drawImage(v, 0, 0, 32, 32);
      const d = ctx.getImageData(0, 0, 32, 32).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4)
        s +=
          0.2126 * (d[i] as number) + 0.7152 * (d[i + 1] as number) + 0.0722 * (d[i + 2] as number);
      const b = s / (d.length / 4) / 255;
      setCoach(
        b < 0.3
          ? t("coachDark")
          : b > 0.9
            ? t("coachBright")
            : mode === "photo"
              ? t("coachStraight")
              : t("coachFlat"),
      );
    }, 2000);
    return () => window.clearInterval(id);
  }, [cameraOn, mode, t]);

  const process = async (source: CanvasImageSource, w: number, h: number, originalUrl: string) => {
    setBusy(true);
    setFailed(false);
    try {
      const r = await fixImage(source, w, h, spec);
      setOriginal(originalUrl);
      setResult(r);
      setPhase("result");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const snap = async () => {
    const v = videoRef.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth || 640;
    c.height = v.videoHeight || 800;
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    stop();
    await process(c, c.width, c.height, c.toDataURL("image/jpeg", 0.7));
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await loadImage(file);
      stop();
      await process(img, img.naturalWidth, img.naturalHeight, img.src);
    } catch {
      setFailed(true);
    }
  };

  // Signature pad (pointer events; pressure ignored).
  const drawing = useRef(false);
  const padDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = padRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    drawing.current = true;
    c.setPointerCapture(e.pointerId);
    const r = c.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(
      ((e.clientX - r.left) / r.width) * c.width,
      ((e.clientY - r.top) / r.height) * c.height,
    );
  };
  const padMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = padRef.current;
    const ctx = c?.getContext("2d");
    if (!drawing.current || !c || !ctx) return;
    const r = c.getBoundingClientRect();
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
    ctx.lineTo(
      ((e.clientX - r.left) / r.width) * c.width,
      ((e.clientY - r.top) / r.height) * c.height,
    );
    ctx.stroke();
  };
  const padUp = () => {
    drawing.current = false;
  };
  useEffect(() => {
    if (phase !== "pad") return;
    const c = padRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
    }
  }, [phase]);

  const markDone = (state: "done" | "paper") => {
    const active = getActiveCase();
    if (active)
      writeDocs(active.caseId, mode === "photo" ? { photo: "done" } : { signature: state });
  };

  const back = <BackLink href="/apply/documents">{t("backToDocs")}</BackLink>;

  if (phase === "denied") {
    return (
      <div className="mj-screen" data-screen={mode === "photo" ? "SCR-035" : "SCR-037"}>
        {back}
        <EmptyState
          as="h1"
          title={t("deniedTitle")}
          line={t("deniedLine")}
          action={
            <Button variant="primary" size="lg" onPress={() => fileRef.current?.click()}>
              <Upload aria-hidden="true" />
              {t("upload")}
            </Button>
          }
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
    );
  }

  if (phase === "result" && result) {
    return (
      <div className="mj-screen" data-screen="SCR-036">
        {back}
        <h1 className="mj-title">{mode === "photo" ? t("resultPhoto") : t("resultSignature")}</h1>
        <div className="mj-before-after">
          <figure>
            {original ? <img src={original} alt={t("altOriginal")} /> : null}
            <figcaption>{t("original")}</figcaption>
          </figure>
          <figure>
            <img src={result.url} alt={t("altFixed")} data-testid="fixed-image" />
            <figcaption>{t("fixed")}</figcaption>
          </figure>
        </div>
        <ul className="mj-ticks" data-testid="fix-checks">
          {result.checks.map((c) => (
            <li key={c.id}>
              <StatusGlyph kind={c.ok ? "done" : "caution"} size={20} />
              <span>
                {t(`check.${c.id}` as "check.whitened", {
                  w: result.width,
                  h: result.height,
                  kb: result.kb,
                  max: spec.hardMaxKb,
                  band: `${spec.minKb}–${spec.maxKb}`,
                  name: safeFileName(spec.kind),
                })}
              </span>
            </li>
          ))}
        </ul>
        <Banner tone="info" title={t("specTitle")}>
          {t("specBody")}
        </Banner>
        {mode === "photo" ? (
          <Banner tone="caution" title={t("finalTitle")}>
            {t("finalBody")}
          </Banner>
        ) : null}
        <p className="mj-caption">{t("neverUploaded")}</p>
        <div className="mj-actions">
          <a
            href={result.url}
            download={safeFileName(spec.kind)}
            className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            onClick={() => {
              markDone("done");
              setTimeout(() => router.push("/apply/documents"), 300);
            }}
            data-testid="save-image"
          >
            {t("save")}
          </a>
          <Button
            variant="secondary"
            size="lg"
            onPress={() => {
              setResult(null);
              setPhase("capture");
            }}
          >
            {t("retake")}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "pad") {
    return (
      <div className="mj-screen" data-screen="SCR-037">
        {back}
        <h1 className="mj-title">{t("padTitle")}</h1>
        <p className="mj-sub">{t("padHint")}</p>
        <canvas
          ref={padRef}
          width={800}
          height={280}
          className="mj-pad"
          aria-label={t("padLabel")}
          role="img"
          onPointerDown={padDown}
          onPointerMove={padMove}
          onPointerUp={padUp}
          onPointerCancel={padUp}
          data-testid="signature-pad"
        />
        <div className="mj-actions">
          <Button
            variant="primary"
            size="lg"
            isPending={busy}
            onPress={() => {
              const c = padRef.current;
              if (c) void process(c, c.width, c.height, c.toDataURL("image/png"));
            }}
          >
            {t("usePad")}
          </Button>
          <Button variant="secondary" onPress={() => setPhase("pad")}>
            {t("clearPad")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mj-screen" data-screen={mode === "photo" ? "SCR-035" : "SCR-037"}>
      {back}
      <h1 className="mj-title">{mode === "photo" ? t("photoTitle") : t("signatureTitle")}</h1>
      <p className="mj-sub">{mode === "photo" ? t("photoHint") : t("signatureHint")}</p>
      <div className={`mj-camera${mode === "signature" ? " mj-camera--signature" : ""}`}>
        <video ref={videoRef} playsInline muted aria-label={t("cameraLabel")} hidden={!cameraOn} />
        <div className="mj-camera__guide" aria-hidden="true" />
      </div>
      <p aria-live="assertive" className="mj-muted">
        {cameraOn ? coach : t("cameraOff")}
      </p>
      {failed ? (
        <Banner tone="caution" title={t("failTitle")}>
          {t("failBody")}
        </Banner>
      ) : null}
      <div className="mj-actions">
        {cameraOn ? (
          <Button variant="primary" size="lg" isPending={busy} onPress={() => void snap()}>
            <Camera aria-hidden="true" />
            {t("take")}
          </Button>
        ) : (
          <Button variant="primary" size="lg" onPress={() => void startCamera()}>
            <Camera aria-hidden="true" />
            {t("openCamera")}
          </Button>
        )}
        <Button variant="secondary" size="lg" onPress={() => fileRef.current?.click()}>
          <Upload aria-hidden="true" />
          {t("upload")}
        </Button>
        {mode === "signature" ? (
          <>
            <Button variant="secondary" onPress={() => setPhase("pad")}>
              <PenLine aria-hidden="true" />
              {t("signOnScreen")}
            </Button>
            <Button
              variant="tertiary"
              onPress={() => {
                markDone("paper");
                router.push("/apply/documents");
              }}
              data-testid="sign-later"
            >
              {t("paperLater")}
            </Button>
          </>
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        data-testid="image-upload"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <p className="mj-caption">{t("neverUploaded")}</p>
      <p className="mj-caption">{tc("onDevice")}</p>
    </div>
  );
}
