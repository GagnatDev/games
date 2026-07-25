import { useEffect, useState } from "react";
import type { JsonObject, MeResponse } from "@games/shared";
import { api } from "../api/client";
import { useApi } from "../hooks/useApi";
import {
  disablePush,
  enablePush,
  readPushState,
  sendTestPush,
  type PushState,
} from "../push/subscribe";

/**
 * The player profile.
 *
 * `profile` is a jsonb document on the `users` row, so preferences can grow (and
 * differ per game) without a migration. The shell only uses two keys today; a
 * game is free to add its own namespaced ones.
 */
export function ProfilePage() {
  const { data, error, loading, reload } = useApi<MeResponse>("/api/me");
  const [displayName, setDisplayName] = useState("");
  // Preferences are held locally and echoed to the server, rather than rendered
  // straight from the response: a checkbox bound only to server state snaps back
  // to its old value for the duration of the round-trip.
  const [prefs, setPrefs] = useState<JsonObject>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setDisplayName(data.displayName ?? "");
    setPrefs(data.profile ?? {});
  }, [data]);

  const reduceMotion = prefs["reduceMotion"] === true;

  async function save(patch: { displayName?: string; profile?: JsonObject }) {
    setSaving(true);
    setSaved(false);
    setProfileError(null);
    try {
      await api.patch<MeResponse>("/api/me", patch);
      setSaved(true);
      reload();
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="stack">
      <header className="page-head">
        <h1>Profile</h1>
        <p className="muted">
          Identity comes from <code>auth.homectl.no</code>; everything below is
          stored by this app.
        </p>
      </header>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="error">Could not load your profile: {error}</p>}

      {data && (
        <>
          <div className="card stack">
            <h2>Display name</h2>
            <p className="muted small">Shown on leaderboards. {data.email}</p>
            <form
              className="row"
              onSubmit={(event) => {
                event.preventDefault();
                void save({ displayName: displayName.trim() || undefined });
              }}
            >
              <input
                type="text"
                value={displayName}
                maxLength={80}
                onChange={(event) => setDisplayName(event.target.value)}
                aria-label="Display name"
              />
              <button type="submit" disabled={saving}>
                Save
              </button>
            </form>
            {saved && <p className="muted small">Saved.</p>}
            {profileError && <p className="error">{profileError}</p>}
          </div>

          <div className="card stack">
            <h2>Preferences</h2>
            <label className="row row--tight">
              <input
                type="checkbox"
                checked={reduceMotion}
                onChange={(event) => {
                  const next = { ...prefs, reduceMotion: event.target.checked };
                  setPrefs(next);
                  void save({ profile: next });
                }}
              />
              <span>Reduce motion and animation</span>
            </label>
            <details>
              <summary className="muted small">Stored profile document</summary>
              <pre className="code-block">{JSON.stringify(data.profile, null, 2)}</pre>
            </details>
          </div>

          <PushCard />
        </>
      )}
    </section>
  );
}

function PushCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    readPushState()
      .then(setState)
      .catch(() => setState({ status: "unsupported" }));
  }, []);

  async function run(action: () => Promise<PushState | { sent: number }>) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if ("status" in result) setState(result);
      else setMessage(`Sent to ${result.sent} device(s).`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "push request failed");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  return (
    <div className="card stack">
      <h2>Notifications</h2>

      {state.status === "unsupported" && (
        <p className="muted small">This browser cannot receive Web Push.</p>
      )}
      {state.status === "unconfigured" && (
        <p className="muted small">
          No VAPID keys in this deployment, so push is off. In production they come
          from the Terraform-managed <code>games-vapid-secrets</code>.
        </p>
      )}
      {state.status === "denied" && (
        <p className="muted small">
          Notifications are blocked for this site in your browser settings.
        </p>
      )}

      {state.status === "off" && (
        <>
          <p className="muted small">
            Get told when something happens in a game you are playing.
          </p>
          <button type="button" disabled={busy} onClick={() => void run(enablePush)}>
            Enable notifications
          </button>
        </>
      )}

      {state.status === "on" && (
        <>
          <p className="muted small">This device is subscribed.</p>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => void run(sendTestPush)}>
              Send a test
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => void run(disablePush)}
            >
              Turn off
            </button>
          </div>
        </>
      )}

      {message && <p className="muted small">{message}</p>}
    </div>
  );
}
