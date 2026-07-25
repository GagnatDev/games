import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link } from "react-router-dom";
import { GAME_2048_ID } from "@games/shared/catalogue";
import type { JsonObject, SaveResponse, ScoreEntry } from "@games/shared";
import { ApiError, SessionExpiredError, api } from "../../api/client";
import { SIZE, WINNING_VALUE, highestTile, type Direction, type Tile } from "./engine";
import {
  NO_CHANGES,
  STATE_VERSION,
  applyMove,
  isCelebrating,
  newGameState,
  parseState,
  type Game2048State,
  type MoveChanges,
} from "./state";
import "./styles.css";

const SAVE_PATH = `/api/games/${GAME_2048_ID}/saves/default`;
const PROGRESS_PATH = `/api/games/${GAME_2048_ID}/progress`;
const EVENTS_PATH = `/api/games/${GAME_2048_ID}/events`;
const SCORE_BOARD = "high-score";
const SCORES_PATH = `/api/games/${GAME_2048_ID}/scores?board=${SCORE_BOARD}&limit=5`;

/** Moves are cheap and can arrive in bursts; the save follows a beat later. */
const SAVE_DEBOUNCE_MS = 450;
/** Long enough for the slide to finish, short enough to keep bursts responsive. */
const ANIMATION_MS = 180;
const SWIPE_THRESHOLD_PX = 24;

const KEYS: Record<string, Direction> = {
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
  k: "up",
  j: "down",
  h: "left",
  l: "right",
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * 2048.
 *
 * The rules live in `engine.ts` and the save document in `state.ts`; this file is
 * input, animation and the conversation with the platform API. Everything under
 * this directory — the stylesheet included — ships in the game's own chunk, so no
 * other game pays for it.
 */
export default function Game2048() {
  const [state, setState] = useState<Game2048State | null>(null);
  const [changes, setChanges] = useState<MoveChanges>(NO_CHANGES);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoable, setUndoable] = useState<Game2048State | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [revision, setRevision] = useState<number | null>(null);

  const {
    data: scores,
    error: scoresError,
    reload: reloadScores,
  } = useLeaderboard();

  // Refs, not state: the input handlers read the board synchronously so a burst
  // of keypresses cannot lose a move to a not-yet-rendered update.
  const stateRef = useRef<Game2048State | null>(null);
  const revisionRef = useRef<number | null>(null);
  const pendingRef = useRef<Game2048State | null>(null);
  const writingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsRef = useRef<JsonObject>({});
  const reportedRef = useRef<{ over: string | null; won: string | null }>({
    over: null,
    won: null,
  });
  const playedRef = useRef({ loaded: 0, since: Date.now() });

  const adopt = useCallback((next: Game2048State, rev: number | null) => {
    stateRef.current = next;
    setState(next);
    if (rev !== null) {
      revisionRef.current = rev;
      setRevision(rev);
    }
  }, []);

  const playedSeconds = useCallback(
    () =>
      playedRef.current.loaded +
      Math.floor((Date.now() - playedRef.current.since) / 1000),
    [],
  );

  /**
   * Write whatever board the player last left behind. A burst of moves coalesces
   * into one PUT, and writes never overlap: two in flight at once would race on
   * `expectedRevision` and turn the player's own second move into a conflict.
   */
  const flush = useCallback(async () => {
    if (writingRef.current) return; // the running loop will pick the board up
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
            status: next.status === "over" ? "completed" : "active",
            playedSeconds: playedSeconds(),
            // Optimistic concurrency: omitted only for the very first write.
            ...(revisionRef.current !== null
              ? { expectedRevision: revisionRef.current }
              : {}),
          });
          revisionRef.current = written.revision;
          setRevision(written.revision);
          setSaveStatus("saved");
        } catch (err) {
          // The client has already started the single re-login navigation.
          if (err instanceof SessionExpiredError) return;

          if (err instanceof ApiError && err.status === 409) {
            // Another device moved first. Its board wins — this one adopts it
            // rather than clobbering a run in progress.
            const adopted = await adoptServerBoard();
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

    async function adoptServerBoard(): Promise<boolean> {
      try {
        const server = await api.get<SaveResponse>(SAVE_PATH);
        const parsed = parseState(server.state);
        if (!parsed) return false;
        pendingRef.current = null;
        adopt(parsed, server.revision);
        setUndoable(null);
        setChanges(NO_CHANGES);
        setNotice("Picked up the board from your other device.");
        setSaveStatus("saved");
        return true;
      } catch {
        return false;
      }
    }
  }, [adopt, playedSeconds]);

  const queueSave = useCallback(
    (next: Game2048State, immediate = false) => {
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

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [save, progress] = await Promise.all([
          api.get<SaveResponse>(SAVE_PATH).catch((err: unknown) => {
            // A 404 just means this player has never started.
            if (err instanceof ApiError && err.status === 404) return null;
            throw err;
          }),
          api
            .get<{ stats: JsonObject }>(PROGRESS_PATH)
            .catch(() => ({ stats: {} as JsonObject })),
        ]);
        if (!active) return;

        statsRef.current = progress.stats ?? {};

        if (!save) {
          const fresh = newGameState(number(statsRef.current["bestScore"]));
          adopt(fresh, null);
          setPhase("ready");
          // Persist straight away, so the board on screen is the stored one.
          queueSave(fresh, true);
          return;
        }

        playedRef.current = { loaded: save.playedSeconds, since: Date.now() };
        const parsed = parseState(save.state);
        if (!parsed) {
          // Never reset a save we cannot read — report it and let the player choose.
          revisionRef.current = save.revision;
          setRevision(save.revision);
          setPhase("ready");
          setProblem(
            `The stored board was written by a different version of this game ` +
              `(state version ${save.stateVersion}). It has been left untouched.`,
          );
          return;
        }

        adopt(parsed, save.revision);
        setPhase("ready");
        setSaveStatus("saved");
      } catch (err) {
        if (!active || err instanceof SessionExpiredError) return;
        setPhase("error");
        setProblem(err instanceof Error ? err.message : "could not load the board");
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [adopt, queueSave]);

  // Flush the last move when the player leaves — a debounce that never fires
  // would silently lose a turn.
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

  // ── Turns ─────────────────────────────────────────────────────────────────

  const play = useCallback(
    (direction: Direction) => {
      const current = stateRef.current;
      if (!current) return;
      // The win overlay covers the board, so a move behind it would be blind.
      if (isCelebrating(current)) return;

      const next = applyMove(current, direction);
      if (!next) return;

      setUndoable(current);
      setChanges(next.changes);
      setNotice(null);
      adopt(next.state, null);
      queueSave(next.state, next.state.status === "over");
    },
    [adopt, queueSave],
  );

  const restart = useCallback(() => {
    const best = Math.max(
      stateRef.current?.best ?? 0,
      number(statsRef.current["bestScore"]),
    );
    const fresh = newGameState(best);
    playedRef.current = { loaded: playedSeconds(), since: Date.now() };
    setUndoable(null);
    setChanges(NO_CHANGES);
    setProblem(null);
    setNotice(null);
    adopt(fresh, null);
    queueSave(fresh, true);
  }, [adopt, playedSeconds, queueSave]);

  const undo = useCallback(() => {
    if (!undoable) return;
    setChanges(NO_CHANGES);
    setNotice(null);
    adopt(undoable, null);
    setUndoable(null);
    queueSave(undoable, true);
  }, [adopt, queueSave, undoable]);

  const playOn = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    const next = { ...current, playingOn: true };
    adopt(next, null);
    queueSave(next, true);
  }, [adopt, queueSave]);

  // Drop the animation classes once the slide is over, so the next move starts
  // from a clean board.
  useEffect(() => {
    if (changes === NO_CHANGES) return;
    const timer = setTimeout(() => setChanges(NO_CHANGES), ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [changes]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const direction = KEYS[event.key.toLowerCase()];
      if (!direction) return;
      // Arrow keys scroll the page otherwise, which fights every swipe upwards.
      event.preventDefault();
      play(direction);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [play]);

  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    swipeStart.current = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD_PX) return;

    play(
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? "right"
          : "left"
        : dy > 0
          ? "down"
          : "up",
    );
  }

  // ── Progression, leaderboard, events ──────────────────────────────────────

  useEffect(() => {
    if (!state) return;

    if (state.reachedTarget && reportedRef.current.won !== state.startedAt) {
      reportedRef.current.won = state.startedAt;
      void api
        .post(EVENTS_PATH, {
          events: [
            {
              kind: "run.reached-target",
              payload: { score: state.score, moves: state.moves },
            },
          ],
        })
        .catch(() => undefined);
    }

    if (state.status !== "over" || reportedRef.current.over === state.startedAt) return;
    reportedRef.current.over = state.startedAt;

    const best = highestTile(state.tiles);
    const stats = statsRef.current;
    const merged: JsonObject = {
      runs: number(stats["runs"]) + 1,
      bestScore: Math.max(number(stats["bestScore"]), state.score),
      bestTile: Math.max(number(stats["bestTile"]), best),
      totalMoves: number(stats["totalMoves"]) + state.moves,
    };
    statsRef.current = { ...stats, ...merged };

    void (async () => {
      try {
        // PATCH shallow-merges, so a stat added by a later build survives.
        await api.patch(PROGRESS_PATH, { stats: merged });
        await api.post(`/api/games/${GAME_2048_ID}/scores`, {
          board: SCORE_BOARD,
          score: state.score,
          details: { highestTile: best, moves: state.moves },
        });
        await api.post(EVENTS_PATH, {
          events: [
            {
              kind: "run.over",
              payload: { score: state.score, highestTile: best, moves: state.moves },
            },
          ],
        });
        reloadScores();
      } catch {
        // A lost leaderboard row must never break the board in front of the player.
      }
    })();
  }, [reloadScores, state]);

  // ── Render ────────────────────────────────────────────────────────────────

  const cells = useMemo(
    () => Array.from({ length: SIZE * SIZE }, (_, index) => index),
    [],
  );

  const won = state ? isCelebrating(state) : false;
  const over = state?.status === "over";
  const announcement = state
    ? over
      ? `Game over. Final score ${state.score}.`
      : won
        ? `You reached ${WINNING_VALUE}. Score ${state.score}.`
        : `Score ${state.score}. Highest tile ${highestTile(state.tiles)}.`
    : "";

  return (
    <section className="stack">
      <header className="page-head">
        <p className="muted small">
          <Link to="/">← Hub</Link>
        </p>
        <h1>2048</h1>
        <p className="muted">
          Slide the tiles, merge the pairs, and keep the board alive to {WINNING_VALUE}.
        </p>
        <span className="pill pill--live">playable</span>
      </header>

      {phase === "loading" && <p className="muted">Loading your board…</p>}
      {phase === "error" && <p className="error">{problem}</p>}

      {phase === "ready" && (
        <>
          {problem && (
            <div className="card card--notice stack">
              <p className="error">{problem}</p>
              <div className="row">
                <button type="button" onClick={restart}>
                  Start a new game
                </button>
              </div>
            </div>
          )}

          {state && (
            <div className="g2048 stack">
              <div className="g2048-bar">
                <dl className="g2048-scores">
                  <div className="g2048-score">
                    <dt>Score</dt>
                    <dd data-testid="score">{state.score}</dd>
                  </div>
                  <div className="g2048-score">
                    <dt>Best</dt>
                    <dd data-testid="best">{state.best}</dd>
                  </div>
                </dl>
                <div className="row row--tight">
                  <button type="button" className="ghost" disabled={!undoable} onClick={undo}>
                    Undo
                  </button>
                  <button type="button" onClick={restart}>
                    New game
                  </button>
                </div>
              </div>

              <div className="g2048-stage">
                <div
                  className="g2048-board"
                  role="application"
                  aria-label={`2048 board, ${SIZE} by ${SIZE}. Use the arrow keys or swipe to move the tiles.`}
                  tabIndex={0}
                  onPointerDown={onPointerDown}
                  onPointerUp={onPointerUp}
                >
                  <div className="g2048-cells" aria-hidden="true">
                    {cells.map((index) => (
                      <div key={index} className="g2048-cell" />
                    ))}
                  </div>

                  {changes.consumed.map((tile) => (
                    <TileView key={`ghost-${tile.id}`} tile={tile} ghost />
                  ))}
                  {state.tiles.map((tile) => (
                    <TileView
                      key={tile.id}
                      tile={tile}
                      merged={changes.mergedIds.includes(tile.id)}
                      fresh={changes.spawnedId === tile.id}
                    />
                  ))}
                </div>

                {(won || over) && (
                  <div className="g2048-overlay" role="alertdialog" aria-label={announcement}>
                    <p className="g2048-overlay__title">
                      {over ? "No moves left" : `${WINNING_VALUE}!`}
                    </p>
                    <p className="muted">
                      {over
                        ? `Final score ${state.score} after ${state.moves} ${
                            state.moves === 1 ? "move" : "moves"
                          }.`
                        : "The board is still open — keep merging if you want a bigger number."}
                    </p>
                    <div className="row">
                      {won && (
                        <button type="button" onClick={playOn}>
                          Keep going
                        </button>
                      )}
                      <button
                        type="button"
                        className={won ? "ghost" : undefined}
                        onClick={restart}
                      >
                        New game
                      </button>
                      {over && undoable && (
                        <button type="button" className="ghost" onClick={undo}>
                          Undo last move
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="g2048-pad" role="group" aria-label="Move the tiles">
                <button
                  type="button"
                  className="ghost g2048-pad__up"
                  aria-label="Move up"
                  onClick={() => play("up")}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="ghost g2048-pad__left"
                  aria-label="Move left"
                  onClick={() => play("left")}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="ghost g2048-pad__down"
                  aria-label="Move down"
                  onClick={() => play("down")}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="ghost g2048-pad__right"
                  aria-label="Move right"
                  onClick={() => play("right")}
                >
                  →
                </button>
              </div>

              <p className="muted small" aria-live="polite">
                {announcement}
              </p>

              <p className="muted small" data-testid="save-status">
                {saveStatus === "saving" && "Saving…"}
                {saveStatus === "saved" &&
                  `Saved${revision !== null ? ` · revision ${revision}` : ""}`}
                {saveStatus === "error" && <span className="error">{notice}</span>}
                {saveStatus !== "error" && notice && ` · ${notice}`}
              </p>
            </div>
          )}

          <div className="card stack">
            <h2>High scores</h2>
            {scoresError && <p className="muted small">Leaderboard unavailable.</p>}
            {!scoresError && (scores?.length ?? 0) === 0 && (
              <p className="muted small">No finished runs yet. Play one to the end.</p>
            )}
            {(scores?.length ?? 0) > 0 && (
              <ol className="g2048-scoreboard" data-testid="high-scores">
                {(scores ?? []).map((entry) => (
                  <li key={`${entry.userId}-${entry.achievedAt}`}>
                    <span>{entry.displayName ?? "Player"}</span>
                    <span className="g2048-scoreboard__value">{entry.score}</span>
                    <span className="muted small">
                      tile {number(entry.details["highestTile"]) || "—"}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <details className="card">
            <summary>How to play</summary>
            <ul className="ticks">
              <li>Arrow keys, WASD or HJKL — or swipe the board on a touch screen.</li>
              <li>
                Every tile slides as far as it can; two equal tiles that meet become
                one worth double, and that pair is spent for the rest of the move.
              </li>
              <li>A new 2 (sometimes a 4) appears after each move that changes the board.</li>
              <li>
                Reach {WINNING_VALUE} to win — the board stays open afterwards if you
                want a bigger number. It ends when no direction moves anything.
              </li>
              <li>
                The run is saved on the server after every move, so you can finish it
                on another device. <strong>Undo</strong> covers the last move only and
                does not survive a reload.
              </li>
            </ul>
          </details>
        </>
      )}
    </section>
  );
}

function TileView({
  tile,
  merged = false,
  fresh = false,
  ghost = false,
}: {
  tile: Tile;
  merged?: boolean;
  fresh?: boolean;
  ghost?: boolean;
}) {
  const classes = ["g2048-tile"];
  if (merged) classes.push("g2048-tile--merged");
  if (fresh) classes.push("g2048-tile--fresh");
  if (ghost) classes.push("g2048-tile--ghost");
  if (tile.value >= 1024) classes.push("g2048-tile--wide");

  return (
    <div
      className={classes.join(" ")}
      data-value={tile.value <= 8192 ? tile.value : "big"}
      style={{ "--row": String(tile.row), "--col": String(tile.col) } as CSSProperties}
      aria-hidden={ghost}
    >
      {tile.value}
    </div>
  );
}

/**
 * The board's top five, straight from the platform's leaderboard. Kept local so
 * the shell's `useApi` stays out of the game's dependency story.
 */
function useLeaderboard() {
  const [data, setData] = useState<ScoreEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    api
      .get<ScoreEntry[]>(SCORES_PATH)
      .then((entries) => {
        if (active) setData(entries);
      })
      .catch((err: unknown) => {
        if (!active || err instanceof SessionExpiredError) return;
        setError(err instanceof Error ? err.message : "unavailable");
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  return { data, error, reload };
}

/** jsonb comes back untyped; a missing or odd stat counts as zero. */
function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
