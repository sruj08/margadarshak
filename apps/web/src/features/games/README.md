# Game host (`src/features/games`)

> Owner: workstream C (MD-205). Status: P2, stable API. Consumers: Nazar (C), LL simulator (D), Stopping Distance and Blind Spot (E).
> Related: GAME_SDK §3–§8, FRONTEND §10 and §18, UI_SPEC_LEARN_GAMES §4.

One host runs every game. A game ships a **`WebGame`** (a React component plus a static description) as the default export of its module file; the host starts the session, records events, pauses on a hidden page, submits the replay and shows the result. A game never calls `fetch`, storage or the router: it talks to the recorder and to the props below.

## 1. Mounting a game (a play page)

```tsx
// src/app/[locale]/(play)/learn/practise/<game>/play/page.tsx → a small client wrapper:
"use client";
import dynamic from "next/dynamic";
const GameStage = dynamic(
  () => import("@/features/games/host/GameStage").then((m) => m.GameStage),
  { ssr: false },
);

export function MyGamePlay({ mode }: { mode: "learn" | "practice" | "mock" }) {
  return (
    <GameStage
      gameId="stopping_distance"
      mode={mode}
      exitHref="/learn/practise/stopping-distance"
      load={() => import("@/features/stopping-distance/module")} // or a line in registry.ts
    />
  );
}
```

`GameStageProps`:

| Prop | Meaning |
|---|---|
| `gameId`, `mode` | game-core `GameId`, `GameMode` (`learn \| practice \| mock \| pair`) |
| `drillId?` | a debrief drill (`DR-…`), sent to API-34 to narrow items |
| `difficulty?` | 1–5 or `null` (staircase); ignored for mock |
| `study?` | `{ participantCode, phase }` for the field study |
| `familyMemberId?` | family mode; the server checks the parent's consent (403 → the stage says so) |
| `load?` | the game's loader; without it the stage uses `GAME_REGISTRY[gameId]` |
| `deviceItems?` | items for a device session when the game-core fixtures are not the right items (e.g. D's LL bank): `{ items, docs, formats?, publicDocs? }` |
| `exitHref` | locale-less path for Quit and Done |
| `debriefHref?` | `(outcome) => path \| null`; default `/learn/practise/sessions/{sid}/debrief` |
| `onComplete?` | called once the run is saved and submitted (or queued) |

Always load the stage with `next/dynamic(…, { ssr: false })` and keep the game module behind `load`/the registry: **no game or host code may enter a route's first load** (the `@smoke` spec in `tests/e2e/specs/p2-nazar.spec.ts` checks this for Nazar with `window.__mdGames`). Set `window.__mdGames = { ...window.__mdGames, <gameId>: true }` at the top of your module file if you want the same check.

## 2. The `WebGame` contract (`types.ts`)

```ts
export default {
  gameId: "stopping_distance",
  replayManifest: { gameId, version: "1.0.0", scoringVersion: "1.0", budgets: { maxEvents, maxSessionSeconds } },
  Component: MyGame,            // React component receiving WebGameProps
  hostStart: true,              // default: the host shows "Ready → Start" after init
  ResultsExtra: MyResultLines,  // optional lines inside the host's results reveal
} satisfies WebGame;
```

`WebGameProps` (what your component receives):

| Prop | Use |
|---|---|
| `ctx` | game-core `SessionContext` (no personal data, ever) |
| `session` | `{ start, source: "server" \| "device", items, media: "video" \| "placeholder", deviceContent }`: `items[i]` has `asset_url`, `public` (client-safe document) and, for learn/practice, `reveal` windows |
| `recorder` | game-core `EventRecorder`: `emit(type, payload, { item, mt })`, `sample(...)` |
| `lifecycle` | game-core `SessionLifecycle` (read it; the host owns transitions) |
| `a11y` | `{ reducedMotion, screenReaderAlt, tapOnly, leftHanded, largeText, soundOn }` |
| `paused` | true while the pause sheet is open (user pause or hidden page) |
| `register(module)` | call once on mount with your `WebGameModule`; returns the unregister function |
| `reportProgress({ loaded, total, unit })` | progress while `init` preloads (`bytes` or `items`) |
| `setCurrentItem(item, timed)` | the item on screen; a hidden page voids a **timed** item |
| `setHud({ counter, tag })` | the 48 px top bar: "3/10" and a skill chip (no score in play) |
| `onEnd("completed" \| "timeout")` | the game finished by itself |

`WebGameModule` = game-core `GameModule` + `timingMode` (+ optional `onItemVoided()`). The host calls, in order:

1. `init(ctx, recorder)` (await it: preload **everything** here; the host keeps Start disabled until it resolves, EC-18);
2. `start()` after the host wrote `session_start` (with your `timingMode`);
3. `pause()` / `resume()` (pause is mandatory on a hidden page; before resuming a voided item the host calls `onItemVoided()`: end that item with `item_end { reason: "voided" }`);
4. `end(reason)` (emit any pending `item_end`; the host writes `session_end`), then `destroy()`.

The host owns these events: `session_start`, `session_end`, user `pause`/`resume`, and (through game-core `bindVisibility`) `visibility_hidden` + hidden `pause`. The game emits everything else (`item_start`, `tap`, `prediction`, `answer`, `item_end`, …). If your item has a media clock and you stop it for a question, wrap the stop in `pause { cause: "system" }` / `resume { cause: "system" }` so the clock-drift check subtracts it.

**Phaser games** fit the same shape: the component mounts the canvas (`await import("phaser")` inside an effect), registers a module whose `pause()` pauses the scene loop, and emits events from the scene through the recorder passed in props. React never polls the canvas.

## 3. Sessions, mock vs real

- **Real API** (`NEXT_PUBLIC_API_URL` set): API-34 starts the session (`seed_origin: server`). On end, the run is saved on this phone (`results-store.ts`), the replay package is encoded from the IndexedDB queue (game-core `syncQueue`, Idempotency-Key = sid) and API-35 answers with `CheckedSessionResult`. **The server score wins**; a mismatch is never an accusation.
- **Mock mode, or the API unavailable** (network down, 404/501): a device session over game-core fixture items (`seedOrigin: client_offline`, flagged `INT_OFFLINE_SEED`), scored on the phone with game-core `replay` → **provisional** (`server_checked: false`, `server_score_pct: null`). It never counts for a Nazar Score, XP or a share card.
- **Device content**: with `deviceItems`, the documents you pass are the scoring content of the device session; the host keeps them with the run on this phone (`SessionRecord.deviceContent`) so the provisional preview scores exactly those items. They never leave the phone.
- **Tenant**: `tenant` (or `deviceItems.tenant`) sets the device session's state, so `LLT-<state>` rows resolve; default KL for Nazar, `DEFAULT` (common 15-question format) for the study's LL mock, else JK.
- **Nazar device clips**: `deviceItems` for Nazar takes `NazarClip` documents plus `media[ref] = { url, bytes?, sha256?, posterUrl?, srAltUrl?, origin? }` (e.g. AI-generated scenes, `origin: "ai_generated"`, passed through as `items[].origin`). When every clip has media the player uses the real `<video>` path; otherwise the labelled placeholder.
- **Field study on the device**: `study.phase` `test` deals the form's two blocks (10 clips), `fresh` its third (5), `ll_mock` the LL set; the form is `study.form`, else derived from the participant code (A, B, C by arrival). Blocks are cut from the device clip pool in order; with fewer than 15 clips they wrap (fine for trying the flow, never for study data).
- **Offline at the end**: the run stays queued (status `queued`) and syncs on the `online` event; the results screen updates in place ("Score updated after check").
- **Integrity**: trust < 0.6 shows `NotCountedNote` ("This session wasn't counted for your card"), never an accusation.

## 4. Other exports

`PreGameBrief` (brief template: practise / scored / controls / mode / options + Start link) · `ResultsReveal`, `shownScore` · `GameHud`, `PauseSheet` · `NotCountedNote`, `TRUST_COUNTED_MIN` · `useGameA11y`, `GameA11yProvider`, `a11yModes` · `createWebGameHost` (game-core `GameHost`) · `getSessionRecord`, `listSessionRecords` · `syncPending` · screen states `StateLoading`, `StateEmpty`, `StateError`, `OfflineNote` · API facade `startGameSession`, `completeGameSession`, `getGameSessionReplay`, `getServerDebrief`, `listNazarClips`.

Strings live in `messages/{en,hi}/games.json` (`useTranslations("games")`).

## 5. Files

`host/GameStage.tsx` (the stage) · `host/queue.ts` (IndexedDB queue + sync) · `host/visibility.ts` · `host/a11y-context.tsx` · `host/game-host.ts` · `registry.ts` · `api.ts`, `api-types.ts`, `mock-api.ts` · `results-store.ts` · `brief/`, `hud/`, `results/`, `integrity/` · `games.css`.
