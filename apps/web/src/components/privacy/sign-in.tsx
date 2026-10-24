"use client";

import { Description, Input, Label } from "@heroui/react";
import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { buttonClassName } from "@margdarshak/ui/components/button-class";
import { StatusGlyph } from "@margdarshak/ui/components/status-glyph";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { BackLink } from "@/components/journey/status";
import { Link, useRouter } from "@/i18n/navigation";
import {
  ApiError,
  isOffline,
  requestSignInLink,
  signInWithCode,
  signOut,
  whoAmI,
} from "@/lib/journey/api";
import { KEYS, readJson, writeJson } from "@/lib/journey/storage";

/** Only same-app paths (no scheme, no "//"), so a link cannot send people elsewhere. */
export function safeReturn(v: string | null | undefined): string | null {
  if (!v?.startsWith("/") || v.startsWith("//") || v.includes("\\")) return null;
  return /^\/[A-Za-z0-9/_\-?=&.%]{0,200}$/.test(v) ? v : null;
}

type Phase =
  | { kind: "loading" }
  | { kind: "form" }
  | { kind: "sent"; simulatedCode: string | null }
  | { kind: "redeeming" }
  | { kind: "signedIn" }
  | { kind: "badLink" };

/**
 * Sign in (API-07 / API-08, SCR-155). An e-mail link, no password. Needed only for family mode
 * (adding a child or parent and recording parental consent); everything else works without an
 * account. On sign-in the API moves this device's cases into the account. In the mock build there
 * is no e-mail server, so the link is shown on screen, clearly labelled simulated.
 */
export function SignIn() {
  const t = useTranslations("signIn");
  const tc = useTranslations("common");
  const router = useRouter();
  const locale = useLocale();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [error, setError] = useState<"email" | "offline" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [back, setBack] = useState<string | null>(null);
  const errRef = useRef<HTMLDivElement>(null);
  // A link works once: never redeem it twice (effects can run again in development).
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const q = new URLSearchParams(window.location.search);
    const ret = safeReturn(q.get("return"));
    if (ret) writeJson(KEYS.signInReturn, ret);
    const target = ret ?? safeReturn(readJson<string | null>(KEYS.signInReturn, null));
    setBack(target);
    const code = q.get("code");
    if (code) {
      setPhase({ kind: "redeeming" });
      void signInWithCode(code)
        .then(() => {
          writeJson(KEYS.signInReturn, null);
          setPhase({ kind: "signedIn" });
          if (target) router.replace(target);
        })
        .catch(() => setPhase({ kind: "badLink" }));
      return;
    }
    void whoAmI().then((r) => setPhase({ kind: r.signedIn ? "signedIn" : "form" }));
  }, [router]);

  const send = async () => {
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) {
      setError("email");
      requestAnimationFrame(() => errRef.current?.focus());
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await requestSignInLink(value);
      setPhase({ kind: "sent", simulatedCode: r.simulatedCode });
    } catch (e) {
      setError(
        isOffline(e) ? "offline" : e instanceof ApiError && e.status === 422 ? "email" : "failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mj-screen" data-screen="SCR-155">
      <BackLink href={back ?? "/privacy"}>{tc("back")}</BackLink>
      <header className="mj-head">
        <div className="mj-glow" aria-hidden="true" />
        <h1 className="mj-title">{t("h1")}</h1>
        <p className="mj-sub">{t("sub")}</p>
      </header>

      {phase.kind === "loading" || phase.kind === "redeeming" ? (
        <p role="status" className="mj-caption" aria-busy="true">
          {phase.kind === "redeeming" ? t("redeeming") : t("loading")}
        </p>
      ) : null}

      {phase.kind === "badLink" ? (
        <Banner tone="info" title={t("badLinkTitle")} role="alert">
          {t("badLinkBody")}
        </Banner>
      ) : null}
      {phase.kind === "badLink" ? (
        <Button variant="secondary" size="lg" onPress={() => setPhase({ kind: "form" })}>
          {t("again")}
        </Button>
      ) : null}

      {phase.kind === "signedIn" ? (
        <section className="mj-card" data-testid="signed-in">
          <p className="mj-chips">
            <StatusGlyph kind="done" size={20} />
            <strong>{t("signedIn")}</strong>
          </p>
          <p>{t("merged")}</p>
          <div className="mj-actions">
            <Link
              href={back ?? "/"}
              className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}
            >
              {tc("continue")}
            </Link>
            <Button
              variant="tertiary"
              onPress={async () => {
                await signOut();
                setPhase({ kind: "form" });
              }}
              data-testid="sign-out"
            >
              {t("signOut")}
            </Button>
          </div>
        </section>
      ) : null}

      {phase.kind === "form" ? (
        <form
          className="mj-screen"
          style={{ gap: 14 }}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <ul className="mj-ticks">
            {(["why1", "why2", "why3"] as const).map((k) => (
              <li key={k}>
                <StatusGlyph kind="info" size={20} />
                <span>{t(k)}</span>
              </li>
            ))}
          </ul>
          {error ? (
            <div ref={errRef} tabIndex={-1} role="alert" className="mj-error-summary">
              <strong>{tc("problem")}</strong>
              <a href="#signin-email">{t(`err.${error}`)}</a>
            </div>
          ) : null}
          <div className="mj-input-group">
            <Label htmlFor="signin-email" className="md-field__label">
              {t("emailLabel")}
            </Label>
            <Input
              id="signin-email"
              className="mj-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              aria-invalid={error === "email" ? true : undefined}
              aria-describedby="signin-email-hint"
              onChange={(e) => setEmail(e.target.value)}
              data-testid="signin-email"
            />
            <Description id="signin-email-hint" className="md-field__hint">
              {t("emailHint")}
            </Description>
          </div>
          <div className="mj-actions">
            <Button
              variant="primary"
              size="lg"
              type="submit"
              isPending={busy}
              data-testid="signin-send"
            >
              {t("send")}
            </Button>
          </div>
        </form>
      ) : null}

      {phase.kind === "sent" ? (
        <section className="mj-card" data-testid="signin-sent" role="status">
          <p className="mj-chips">
            <StatusGlyph kind="done" size={20} />
            <strong>{t("sentTitle")}</strong>
          </p>
          <p>{t("sentBody")}</p>
          {phase.simulatedCode ? (
            <Banner tone="simulated" title={t("simTitle")} role="note">
              {t("simBody")}{" "}
              <a
                href={`/${locale}/signin?code=${encodeURIComponent(phase.simulatedCode)}`}
                className="md-link"
                data-testid="signin-simulated-link"
              >
                {t("simLink")}
              </a>
            </Banner>
          ) : null}
          <Button variant="tertiary" onPress={() => setPhase({ kind: "form" })}>
            {t("again")}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
