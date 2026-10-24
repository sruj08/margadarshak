"use client";

import { Banner } from "@margdarshak/ui/components/banner";
import { Button } from "@margdarshak/ui/components/button";
import { useLocale, useTranslations } from "next-intl";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import {
  ADMIN_PERSONAS,
  API_MODE,
  CuratorOffline,
  chooseMockPersona,
  mockPersonas,
  resetMockBoard,
  setCuratorApiLocale,
  startAdminPersonaSession,
  whoAmI,
} from "./api";
import { CuratorError, CuratorLoading, CuratorOfflineState } from "./states";
import type { AdminIdentity } from "./types";

interface AdminCtx {
  identity: AdminIdentity;
  refresh: () => void;
}

const Ctx = createContext<AdminCtx | null>(null);

/** The admin identity of this browser (inside AdminGate). */
export function useAdmin(): AdminCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdmin outside AdminGate");
  return v;
}

type GateState =
  | { k: "checking" }
  | { k: "offline" }
  | { k: "error" }
  | { k: "ready"; identity: AdminIdentity };

/**
 * Admin-only gate for `/admin/**` (plan D4, API-55 `userBearer [admin]`). Real mode: the API
 * session's scope must be `admin` (GET /v1/me), which only the demo clip-team persona sessions
 * carry (a signed-in account never does), so the gate offers those personas; the server checks the
 * scope again on every call, so this gate is about what to render, not the security boundary. Mock mode: a labelled picker of demo
 * pseudonyms (curator-01, rater-01 …), stored on this browser only.
 */
export function AdminGate({ children }: { children: ReactNode }) {
  const t = useTranslations("curator");
  const locale = useLocale();
  const [state, setState] = useState<GateState>({ k: "checking" });
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    void attempt;
    setCuratorApiLocale(locale);
    let alive = true;
    whoAmI()
      .then((identity) => alive && setState({ k: "ready", identity }))
      .catch(
        (e: unknown) => alive && setState({ k: e instanceof CuratorOffline ? "offline" : "error" }),
      );
    return () => {
      alive = false;
    };
  }, [attempt, locale]);

  if (state.k === "checking") return <CuratorLoading label={t("gate.checking")} />;
  if (state.k === "offline") return <CuratorOfflineState />;
  if (state.k === "error") return <CuratorError onRetry={refresh} />;
  const { identity } = state;
  if (!identity.admin) {
    return identity.source === "mock" ? (
      <MockPicker onPicked={refresh} />
    ) : (
      <RealPersonaPicker onPicked={refresh} />
    );
  }
  return (
    <Ctx.Provider value={{ identity, refresh }}>
      {identity.source === "mock" ? <MockBar identity={identity} onChange={refresh} /> : null}
      {children}
    </Ctx.Provider>
  );
}

/** Real mode: admin is a demo persona session (POST /v1/demo/personas/{id}/session), never an account. */
function RealPersonaPicker({ onPicked }: { onPicked: () => void }) {
  const t = useTranslations("curator");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const pick = async (id: (typeof ADMIN_PERSONAS)[number]["id"]) => {
    setBusy(id);
    setFailed(false);
    try {
      await startAdminPersonaSession(id);
      onPicked();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="cu-gate" data-testid="admin-forbidden" aria-labelledby="gate-h">
      <h1 id="gate-h" className="md-h1">
        {t("gate.title")}
      </h1>
      <p>{t("gate.line")}</p>
      <Banner tone="simulated" title={t("gate.personaTitle")}>
        {t("gate.personaLine")}
      </Banner>
      <ul className="cu-personas">
        {ADMIN_PERSONAS.map((p) => (
          <li key={p.id}>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              isPending={busy === p.id}
              isDisabled={busy !== null && busy !== p.id}
              data-testid={`real-persona-${p.pseudonym}`}
              onPress={() => void pick(p.id)}
            >
              {t("gate.actAs", {
                pseudonym: p.pseudonym,
                roles: p.roles.map((r) => t(`gate.roles.${r}`)).join(", "),
              })}
            </Button>
          </li>
        ))}
      </ul>
      {failed ? (
        <p role="alert" className="cu-error" data-testid="real-persona-failed">
          {t("gate.personaFailed")}
        </p>
      ) : null}
      <Link href="/" className="md-link">
        {t("gate.home")}
      </Link>
    </section>
  );
}

function MockPicker({ onPicked }: { onPicked: () => void }) {
  const t = useTranslations("curator");
  const [list, setList] = useState<readonly { pseudonym: string; roles: string[] }[]>([]);
  useEffect(() => {
    void mockPersonas().then(setList);
  }, []);
  return (
    <section className="cu-gate" data-testid="admin-mock-picker" aria-labelledby="gate-h">
      <h1 id="gate-h" className="md-h1">
        {t("gate.title")}
      </h1>
      <Banner tone="simulated" title={t("gate.mockTitle")}>
        {t("gate.mockLine")}
      </Banner>
      <ul className="cu-personas">
        {list.map((p) => (
          <li key={p.pseudonym}>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              data-testid={`persona-${p.pseudonym}`}
              onPress={() => void chooseMockPersona(p.pseudonym).then(onPicked)}
            >
              {t("gate.actAs", {
                pseudonym: p.pseudonym,
                roles: p.roles.map((r) => t(`gate.roles.${r as "curator" | "rater"}`)).join(", "),
              })}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MockBar({ identity, onChange }: { identity: AdminIdentity; onChange: () => void }) {
  const t = useTranslations("curator");
  return (
    <div className="cu-mockbar" data-testid="admin-mock-bar">
      <p role="note">{t("mock.banner")}</p>
      <p>
        <span data-testid="admin-persona">
          {t("mock.persona", { pseudonym: identity.pseudonym ?? "" })}
        </span>
      </p>
      <div className="cu-row">
        <Button
          variant="ghost"
          onPress={() => void chooseMockPersona(null).then(onChange)}
          data-testid="persona-switch"
        >
          {t("mock.switch")}
        </Button>
        {API_MODE === "mock" ? (
          <Button
            variant="ghost"
            onPress={() => void resetMockBoard().then(() => window.location.reload())}
          >
            {t("mock.reset")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
