import { retryLogin } from "../auth/session";
import { UpdateBanner } from "./UpdateBanner";

/**
 * Shown once the re-login budget is spent (see auth/session.ts). Better a visible
 * dead end with one clear action than an invisible redirect loop between this
 * origin and the auth host.
 */
export function SessionLost() {
  return (
    <div className="app app--centered">
      <UpdateBanner />
      <div className="card card--notice">
        <h1>Session expired</h1>
        <p>
          We tried to sign you back in a few times and it did not take. Signing in
          again by hand usually clears it.
        </p>
        <button type="button" onClick={retryLogin}>
          Sign in again
        </button>
      </div>
    </div>
  );
}
