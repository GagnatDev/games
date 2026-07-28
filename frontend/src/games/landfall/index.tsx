import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LANDFALL_ID, findGame } from "@games/shared/catalogue";
import type { JsonObject, SaveResponse, ScoreEntry } from "@games/shared";
import { ApiError, SessionExpiredError, api } from "../../api/client";
import { netWorth } from "./economy";
import {
  STATE_VERSION,
  activeFocus,
  parseState,
  type LandfallState,
  type Stats,
} from "./state";
import { StatusBar } from "./ui/StatusBar";
import { SetupScreen } from "./ui/SetupScreen";
import { PortScreen, type Apply } from "./ui/PortScreen";
import { VoyageScreen } from "./ui/VoyageScreen";
import { DockingScreen } from "./ui/DockingScreen";
import { GameOverScreen } from "./ui/GameOverScreen";
import { moneyShort } from "./ui/format";
import "./styles.css";

const SAVE_PATH = `/api/games/${LANDFALL_ID}/saves/default`;
const PROGRESS_PATH = `/api/games/${LANDFALL_ID}/progress`;
const EVENTS_PATH = `/api/games/${LANDFALL_ID}/events`;
const SCORE_BOARD = "fortune";
const SCORES_PATH = `/api/games/${LANDFALL_ID}/scores?board=${SCORE_BOARD}&limit=5`;

/** Port business is chatty; one PUT a beat after the last click. */
const SAVE_DEBOUNCE_MS = 600;

const STARTING_CAPITAL = (() => {
  const config = findGame(LANDFALL_ID)?.config;
  const value = config?.["startingCapital"];
  return typeof value === "number" ? value : 2_500_000;
})();

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Landfall.
 *
 * A tramp-shipping company in the spirit of Ports of Call: charter freight,
 * mind the fuel curve, survive the noon reports, and berth her by hand when
 * the tugs are on strike. The rules live in the engine modules next door;
 * this file is the conversation with the platform API and the phase router.
 */
export default function Landfall() {
  const [state, setState] = useState<LandfallState | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [founding, setFounding] = useState(false);

  const stateRef = useRef<LandfallState | null>(null);
  const revisionRef = useRef<number | null>(null);
  const pendingRef = useRef<LandfallState | null>(null);
  const writingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lifetimeRef = useRef<JsonObject>({});
  const reportedStatsRef = useRef<Stats | null>(null);
  const reportedRuinRef = useRef<string | null>(null);
  const playedRef = useRef({ loaded: 0, since: Date.now() });

  const { data: scores, reload: reloadScores } = useLeaderboard();

  const adopt = useCallback((next: LandfallState, revision: number | null) => {
    stateRef.current = next;
    setState(next);
    if (revision !== null) revisionRef.current = revision;
  }, []);

  const playedSeconds = useCallback(
    () =>
      playedRef.current.loaded +
      Math.floor((Date.now() - playedRef.current.since) / 1000),
    [],
  );

  /** Writes never overlap; a burst of actions coalesces into one PUT. */
  const flush = useCallback(async () => {
    if (writingRef.current) return;
    writingRef.current = true;
    try {
      while (pendingRef.current) {
        const next = pendingRef.current;
        pendingRef.current = null;
        setSaveStatus("saving");
        try {
          const written = await api.put<SaveResponse>(SAVE_PATH, {
            state: next,
            stateVersion: STATE_VERSION,
            status: next.phase.kind === "bankrupt" ? "completed" : "active",
            playedSeconds: playedSeconds(),
            ...(revisionRef.current !== null
              ? { expectedRevision: revisionRef.current }
              : {}),
          });
          revisionRef.current = written.revision;
          setSaveStatus("saved");
        } catch (err) {
          if (err instanceof SessionExpiredError) return;
          if (err instanceof ApiError && err.status === 409) {
            // Another device acted first — its company wins, this one adopts.
            const adopted = await adoptServerState();
            if (adopted) continue;
          }
          setSaveStatus("error");
          setNotice(err instanceof Error ? err.message : "could not save");
          return;
        }
      }
    } finally {
      writingRef.current = false;
    }

    async function adoptServerState(): Promise<boolean> {
      try {
        const server = await api.get<SaveResponse>(SAVE_PATH);
        const parsed = parseState(server.state);
        if (!parsed) return false;
        pendingRef.current = null;
        adopt(parsed, server.revision);
        setNotice("Picked up the company from your other device.");
        setSaveStatus("saved");
        return true;
      } catch {
        return false;
      }
    }
  }, [adopt, playedSeconds]);

  const queueSave = useCallback(
    (next: LandfallState, immediate = false) => {
      pendingRef.current = next;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (immediate) {
        void flush();
        return;
      }
      timerRef.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [flush],
  );

  /** Every screen mutates the game through this: pure engine in, save out. */
  const apply = useCallback<Apply>(
    (mutate, immediate = false) => {
      const current = stateRef.current;
      if (!current) return;
      const next = mutate(current);
      if (next === current) return;
      setNotice(null);
      adopt(next, null);
      queueSave(
        next,
        immediate ||
          next.phase.kind !== current.phase.kind ||
          activeFocus(next) !== activeFocus(current),
      );
    },
    [adopt, queueSave],
  );

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [save, progress] = await Promise.all([
          api.get<SaveResponse>(SAVE_PATH).catch((err: unknown) => {
            if (err instanceof ApiError && err.status === 404) return null;
            throw err;
          }),
          api
            .get<{ stats: JsonObject }>(PROGRESS_PATH)
            .catch(() => ({ stats: {} as JsonObject })),
        ]);
        if (!active) return;

        lifetimeRef.current = progress.stats ?? {};

        if (!save) {
          setPhase("ready");
          setFounding(true);
          return;
        }

        playedRef.current = { loaded: save.playedSeconds, since: Date.now() };
        const parsed = parseState(save.state);
        if (!parsed) {
          revisionRef.current = save.revision;
          setPhase("ready");
          setProblem(
            `The stored company was written by a different version of this game ` +
              `(state version ${save.stateVersion}). It has been left untouched.`,
          );
          return;
        }

        reportedStatsRef.current = parsed.stats;
        adopt(parsed, save.revision);
        setPhase("ready");
        setSaveStatus("saved");
      } catch (err) {
        if (!active || err instanceof SessionExpiredError) return;
        setPhase("error");
        setProblem(err instanceof Error ? err.message : "could not load the company");
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [adopt]);

  // Flush on the way out, so the last decision is not lost to the debounce.
  useEffect(() => {
    function onHidden() {
      if (document.visibilityState === "hidden" && pendingRef.current) void flush();
    }
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pendingRef.current) void flush();
    };
  }, [flush]);

  // ── Progression, leaderboard, events ──────────────────────────────────────

  useEffect(() => {
    if (!state) return;

    // A finished voyage: bank the lifetime stats and post the fortune.
    const reported = reportedStatsRef.current;
    if (reported && state.stats.voyages > reported.voyages) {
      const delta = {
        voyages: state.stats.voyages - reported.voyages,
        deliveredTons: state.stats.deliveredTons - reported.deliveredTons,
        milesSailed: state.stats.milesSailed - reported.milesSailed,
        rescues: state.stats.rescues - reported.rescues,
        manualDockings: state.stats.manualDockings - reported.manualDockings,
      };
      reportedStatsRef.current = state.stats;
      const lifetime = lifetimeRef.current;
      const worth = netWorth(state);
      const merged: JsonObject = {
        voyages: asNumber(lifetime["voyages"]) + delta.voyages,
        deliveredTons: Math.round(asNumber(lifetime["deliveredTons"]) + delta.deliveredTons),
        milesSailed: Math.round(asNumber(lifetime["milesSailed"]) + delta.milesSailed),
        rescues: asNumber(lifetime["rescues"]) + delta.rescues,
        manualDockings: asNumber(lifetime["manualDockings"]) + delta.manualDockings,
        bestNetWorth: Math.max(asNumber(lifetime["bestNetWorth"]), worth),
      };
      lifetimeRef.current = { ...lifetime, ...merged };

      void (async () => {
        try {
          await api.patch(PROGRESS_PATH, { stats: merged });
          await api.post(`/api/games/${LANDFALL_ID}/scores`, {
            board: SCORE_BOARD,
            score: worth,
            details: { company: state.company, day: state.day, voyages: state.stats.voyages },
          });
          await api.post(EVENTS_PATH, {
            events: [
              {
                kind: "voyage.completed",
                payload: { day: state.day, netWorth: worth, voyages: state.stats.voyages },
              },
            ],
          });
          reloadScores();
        } catch {
          // A lost leaderboard row must never break the game in hand.
        }
      })();
    } else if (!reported) {
      reportedStatsRef.current = state.stats;
    }

    // The wind-up, reported once per company.
    if (state.phase.kind === "bankrupt") {
      const key = `${state.company}:${state.phase.day}`;
      if (reportedRuinRef.current !== key) {
        reportedRuinRef.current = key;
        const lifetime = lifetimeRef.current;
        const merged: JsonObject = {
          bankruptcies: asNumber(lifetime["bankruptcies"]) + 1,
        };
        lifetimeRef.current = { ...lifetime, ...merged };
        void (async () => {
          try {
            await api.patch(PROGRESS_PATH, { stats: merged });
            await api.post(EVENTS_PATH, {
              events: [
                {
                  kind: "company.bankrupt",
                  payload: { day: state.day, company: state.company },
                },
              ],
            });
          } catch {
            // Same rule: the report is best-effort.
          }
        })();
      }
    }
  }, [reloadScores, state]);

  // ── Render ────────────────────────────────────────────────────────────────

  const showSetup = phase === "ready" && (founding || (!state && !problem));

  return (
    <section className="stack lf">
      <header className="page-head">
        <p className="muted small">
          <Link to="/">← Hub</Link>
        </p>
        <h1>Landfall</h1>
        <p className="muted">
          Charter a tramp freighter, chase cargo across the world&apos;s ports,
          and try to out-trade the tide.
        </p>
      </header>

      {phase === "loading" && <p className="muted">Raising the office shutters…</p>}
      {phase === "error" && <p className="error">{problem}</p>}

      {phase === "ready" && (
        <>
          {problem && !founding && (
            <div className="card card--notice stack">
              <p className="error">{problem}</p>
              <div className="row">
                <button type="button" onClick={() => setFounding(true)}>
                  Found a new company
                </button>
              </div>
            </div>
          )}

          {showSetup && (
            <SetupScreen
              startingCapital={STARTING_CAPITAL}
              onFound={(fresh) => {
                setProblem(null);
                setFounding(false);
                reportedStatsRef.current = fresh.stats;
                reportedRuinRef.current = null;
                stateRef.current = fresh;
                setState(fresh);
                queueSave(fresh, true);
              }}
            />
          )}

          {state && !showSetup && (
            <>
              <StatusBar state={state} />

              {activeFocus(state) === "operating" && <PortScreen state={state} apply={apply} />}
              {activeFocus(state) === "voyage" && <VoyageScreen state={state} apply={apply} />}
              {activeFocus(state) === "docking" && <DockingScreen state={state} apply={apply} />}
              {activeFocus(state) === "bankrupt" && (
                <GameOverScreen state={state} onFoundAgain={() => setFounding(true)} />
              )}

              {(activeFocus(state) === "operating" || activeFocus(state) === "bankrupt") && (
                <Fortunes scores={scores} />
              )}

              <p className="muted small" data-testid="lf-save-status" aria-live="polite">
                {saveStatus === "saving" && "Saving…"}
                {saveStatus === "saved" &&
                  `Saved${revisionRef.current !== null ? ` · revision ${revisionRef.current}` : ""}`}
                {saveStatus === "error" && <span className="error">{notice}</span>}
                {saveStatus !== "error" && notice && ` · ${notice}`}
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Fortunes({ scores }: { scores: ScoreEntry[] | null }) {
  return (
    <details className="card lf-fortunes">
      <summary>Fortunes — the owners&apos; club board</summary>
      {(scores?.length ?? 0) === 0 ? (
        <p className="muted small">No fortunes posted yet. Deliver something.</p>
      ) : (
        <ol className="lf-scoreboard" data-testid="lf-fortunes">
          {(scores ?? []).map((entry) => (
            <li key={`${entry.userId}-${entry.achievedAt}`}>
              <span>{entry.displayName ?? "Captain"}</span>
              <span className="lf-scoreboard__value">{moneyShort(entry.score)}</span>
              <span className="muted small">
                {typeof entry.details["company"] === "string" ? entry.details["company"] : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

function useLeaderboard() {
  const [data, setData] = useState<ScoreEntry[] | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    api
      .get<ScoreEntry[]>(SCORES_PATH)
      .then((entries) => {
        if (active) setData(entries);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [nonce]);

  return { data, reload };
}

/** jsonb comes back untyped; a missing or odd stat counts as zero. */
function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
