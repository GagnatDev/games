import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LANDFALL_ID } from "@games/shared/catalogue";
import type { SaveResponse } from "@games/shared";
import { ApiError, api } from "../../api/client";
import {
  STATE_VERSION,
  newGameState,
  parseState,
  type LandfallState,
} from "./state";

const SAVE_PATH = `/api/games/${LANDFALL_ID}/saves/default`;
const EVENTS_PATH = `/api/games/${LANDFALL_ID}/events`;

/**
 * Landfall — shell only.
 *
 * There is no game here yet, on purpose: this route exists so the deploy can be
 * verified end to end (chunk splitting, auth, database, persistence) before any
 * gameplay is written. The panel below writes a real save through the generic
 * gameplay API and reads it back, which is the check that the pod, the Postgres
 * database and the auth sidecar are all actually wired up.
 */
export default function Landfall() {
  const [save, setSave] = useState<SaveResponse | null>(null);
  const [state, setState] = useState<LandfallState | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const loaded = await api.get<SaveResponse>(SAVE_PATH);
      setSave(loaded);
      setState(parseState(loaded.state));
      setStatus("ready");
    } catch (err) {
      // 404 just means this player has never started — not a failure.
      if (err instanceof ApiError && err.status === 404) {
        setSave(null);
        setState(null);
        setStatus("ready");
        return;
      }
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "could not load the save");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function writeSave(next: LandfallState) {
    setBusy(true);
    setMessage(null);
    try {
      const written = await api.put<SaveResponse>(SAVE_PATH, {
        state: next,
        stateVersion: STATE_VERSION,
        // Optimistic concurrency: pass the revision we read so a write from
        // another device wins cleanly instead of being clobbered.
        ...(save ? { expectedRevision: save.revision } : {}),
      });
      setSave(written);
      setState(parseState(written.state));
      await api.post(EVENTS_PATH, {
        events: [{ kind: "shell.save-written", payload: { revision: written.revision } }],
      });
      setMessage(`Saved at revision ${written.revision}.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setMessage("Another device saved first — reloading that version.");
        await load();
        return;
      }
      setMessage(err instanceof Error ? err.message : "could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack">
      <header className="page-head">
        <p className="muted small">
          <Link to="/">← Hub</Link>
        </p>
        <h1>Landfall</h1>
        <p className="muted">
          Charter a tramp freighter, chase cargo across the world&apos;s ports, and
          try to out-trade the tide. A modern take on <em>Ports of Call</em>.
        </p>
        <span className="pill pill--shell">in development</span>
      </header>

      <div className="card stack">
        <h2>Not built yet</h2>
        <p>
          This route is a shell. What is real already: the game gets its own
          bundle, its own save slots, its own progression record and its own
          leaderboards — all through the platform&apos;s generic API, with the game
          state kept as a document only this chunk understands.
        </p>
        <ul className="ticks">
          <li>Ports, cargo contracts and freight rates that move</li>
          <li>A fleet you buy, crew, insure and repair</li>
          <li>Weather, tides and the odd bad decision at sea</li>
          <li>Docking as a real manoeuvre, not a dice roll</li>
        </ul>
      </div>

      <div className="card stack">
        <h2>Deploy check</h2>
        <p className="muted small">
          Writes a placeholder save through <code>PUT {SAVE_PATH}</code> and reads
          it back — proves the pod, Postgres and the auth sidecar are all wired up.
        </p>

        {status === "loading" && <p className="muted">Loading your save…</p>}
        {status === "error" && <p className="error">{message}</p>}

        {status === "ready" && (
          <>
            <dl className="facts">
              <div>
                <dt>Save</dt>
                <dd>{save ? `revision ${save.revision}` : "none yet"}</dd>
              </div>
              <div>
                <dt>State version</dt>
                <dd>{save ? save.stateVersion : STATE_VERSION}</dd>
              </div>
              <div>
                <dt>Port</dt>
                <dd>{state?.captain.port ?? "—"}</dd>
              </div>
              <div>
                <dt>Cash</dt>
                <dd>
                  {state ? `$${state.captain.cash.toLocaleString("en-US")}` : "—"}
                </dd>
              </div>
            </dl>

            <div className="row">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const base = state ?? newGameState();
                  void writeSave({
                    ...base,
                    log: [
                      ...base.log.slice(-9),
                      { at: new Date().toISOString(), note: "deploy check" },
                    ],
                  });
                }}
              >
                {save ? "Write another revision" : "Create a save"}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => void load()}
              >
                Reload from server
              </button>
            </div>

            {save && state === null && (
              <p className="error">
                The stored save does not match this build&apos;s schema (version{" "}
                {save.stateVersion}). It was left untouched.
              </p>
            )}
            {message && status === "ready" && <p className="muted small">{message}</p>}

            {state && (
              <details>
                <summary className="muted small">Stored state document</summary>
                <pre className="code-block">{JSON.stringify(state, null, 2)}</pre>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
