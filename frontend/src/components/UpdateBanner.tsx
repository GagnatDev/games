import { useEffect, useState } from "react";
import { applyUpdate, onUpdateStateChange } from "../pwa/register";

/**
 * Prompt for a waiting service worker.
 *
 * Deliberately mounted in the shell layout *and* on the session-expired screen:
 * behind a forward-auth sidecar a logged-out client cannot check for updates, and
 * if the only "update now" affordance lived inside the authenticated app, an
 * already-downloaded fix could never be activated.
 */
export function UpdateBanner() {
  const [ready, setReady] = useState(false);

  useEffect(() => onUpdateStateChange((state) => setReady(state.updateReady)), []);

  if (!ready) return null;

  return (
    <div className="banner" role="status">
      <span>A new version is ready.</span>
      <button type="button" onClick={applyUpdate}>
        Reload
      </button>
    </div>
  );
}
