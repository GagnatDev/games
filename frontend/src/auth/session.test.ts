import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The recovery funnel is the piece that turns an expired session into exactly one
 * navigation. Its failure modes (a redirect storm, an infinite ping-pong with the
 * auth host) are invisible in normal use and brutal in production, so they are
 * pinned down here.
 */
/**
 * A new module instance stands in for a new page load. sessionStorage is
 * deliberately NOT cleared here — surviving the round-trip to the auth host is
 * exactly what the attempt budget relies on.
 */
async function freshModule() {
  vi.resetModules();
  const mod = await import("./session");
  const assign = vi.spyOn(mod.browserNavigation, "assign").mockImplementation(() => {});
  vi.spyOn(mod.browserNavigation, "here").mockReturnValue("/landfall?slot=default");
  return { ...mod, assign };
}

beforeEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("session recovery", () => {
  it("navigates once, preserving where the player was", async () => {
    const { reportSessionExpired, assign } = await freshModule();

    reportSessionExpired();

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(
      "/auth/relogin?return_to=%2Flandfall%3Fslot%3Ddefault",
    );
  });

  it("collapses a burst of concurrent failures into one navigation", async () => {
    const { reportSessionExpired, assign } = await freshModule();

    // A screen with several parallel requests produces several expiry events.
    reportSessionExpired();
    reportSessionExpired();
    reportSessionExpired();

    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("gives up visibly after three attempts inside the window", async () => {
    let lost = false;

    // Each page load is a new module instance, but the attempt count lives in
    // sessionStorage so it survives the round-trip to the auth host.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const { reportSessionExpired, assign } = await freshModule();
      reportSessionExpired();
      expect(assign).toHaveBeenCalledTimes(1);
    }

    const fourth = await freshModule();
    fourth.onSessionLost((givenUp) => {
      lost = givenUp;
    });
    fourth.reportSessionExpired();

    expect(fourth.assign).not.toHaveBeenCalled();
    expect(lost).toBe(true);
    expect(fourth.sessionGivenUp()).toBe(true);
  });

  it("resets the budget once the session is confirmed good", async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const mod = await freshModule();
      mod.reportSessionExpired();
    }

    const after = await freshModule();
    after.confirmAuthenticated();
    after.reportSessionExpired();

    expect(after.assign).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh budget for an expiry outside the window", async () => {
    const now = Date.now();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const mod = await freshModule();
      mod.reportSessionExpired();
    }

    vi.spyOn(Date, "now").mockReturnValue(now + 10 * 60_000);

    const later = await freshModule();
    later.reportSessionExpired();

    expect(later.assign).toHaveBeenCalledTimes(1);
  });

  it("retryLogin always navigates, even after giving up", async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const mod = await freshModule();
      mod.reportSessionExpired();
    }

    const stuck = await freshModule();
    stuck.reportSessionExpired();
    expect(stuck.assign).not.toHaveBeenCalled();

    stuck.retryLogin();
    expect(stuck.assign).toHaveBeenCalledTimes(1);
  });
});
