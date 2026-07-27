// The fixtures wrapper truncates player data before each test.
import { expect, test } from "./fixtures";

/**
 * The shell's job is to load fast, route to a game, and persist. These tests are
 * the deploy check in executable form.
 */

test("the hub lists the catalogue", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Games", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Landfall/ })).toBeVisible();
  await expect(page.getByText("games.homectl.no/landfall")).toBeVisible();
});

test("a game's code only arrives when the game is opened", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(request.url());
  });

  // A build hash may contain a hyphen, so `\w` is not enough to match one.
  const chunk = (game: string) => new RegExp(`game-${game}-[\\w-]+\\.js`);
  const requested = (game: string) => scripts.filter((url) => chunk(game).test(url));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Games", level: 1 })).toBeVisible();

  // The shell must not pull any game's chunk. This is the whole point of the
  // lazy registry — a static import would quietly undo it.
  expect(requested("landfall")).toHaveLength(0);
  expect(requested("2048")).toHaveLength(0);

  await page.getByRole("link", { name: /Landfall/ }).click();

  await expect(page.getByRole("heading", { name: "Landfall", level: 1 })).toBeVisible();
  await expect.poll(() => requested("landfall").length).toBeGreaterThan(0);
  // …and opening one game still does not drag another one's code along.
  expect(requested("2048")).toHaveLength(0);
});

test("a deep link into a game is served by the backend", async ({ page }) => {
  // Not a client-side route change: a fresh top-level navigation, which in
  // production is what lets the auth sidecar run the login redirect.
  const response = await page.goto("/landfall");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Landfall", level: 1 })).toBeVisible();
});

test("an unknown path renders the not-found view, not a server error", async ({ page }) => {
  const response = await page.goto("/no-such-game");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
});

test("the game shell persists a save and reads it back", async ({ page }) => {
  await page.goto("/landfall");

  // A fresh player lands on founding day.
  await expect(page.getByRole("heading", { name: "Found the company" })).toBeVisible();

  await page.getByLabel("Company name").fill("Deploy Check Lines");
  await page.locator(".lf-offer").first().click();
  await page.getByRole("button", { name: "Sign the papers" }).click();

  // The company is live and the save is in Postgres.
  await expect(page.getByRole("heading", { name: /freight market/ })).toBeVisible();
  await expect(page.getByTestId("lf-save-status")).toContainText("revision 1");

  // Survives a full reload, so it really is stored server-side.
  await page.reload();
  await expect(page.getByRole("heading", { name: /freight market/ })).toBeVisible();
  await expect(page.getByText("Deploy Check Lines")).toBeVisible();
  await expect(page.getByTestId("lf-save-status")).toContainText("revision 1");
});

test("the profile stores a display name and a preference document", async ({ page }) => {
  await page.goto("/profile");

  const name = page.getByLabel("Display name");
  await name.fill("Skipper Ann");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.getByLabel("Reduce motion and animation").check();

  await page.reload();
  await expect(page.getByLabel("Display name")).toHaveValue("Skipper Ann");
  await expect(page.getByLabel("Reduce motion and animation")).toBeChecked();
});

test("push is reported as unavailable without VAPID keys", async ({ page }) => {
  await page.goto("/profile");

  await expect(page.getByText(/No VAPID keys in this deployment/)).toBeVisible();
});
