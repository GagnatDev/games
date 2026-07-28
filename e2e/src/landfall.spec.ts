import type { Page } from "@playwright/test";
// The fixtures wrapper truncates player data before each test.
import { expect, test } from "./fixtures";

/**
 * Landfall through the browser. The trading rules are unit-tested in the
 * frontend package; what matters here is what only a real stack proves — the
 * founding flow persists, a voyage seeded through the platform's own save API
 * arrives and pays out, and the leaderboard hears about it.
 *
 * Voyage weather is random, so anything that needs a known sea state seeds a
 * save mid-voyage with a chosen dice value rather than sailing blind.
 */

/** A minimal, schema-valid v3 company document the tests build on. */
function companyDocument(overrides: Record<string, unknown> = {}) {
  return {
    version: 3,
    company: "Seeded Lines",
    homePort: "rotterdam",
    day: 3,
    cash: 500_000,
    loan: 0,
    reputation: 50,
    seed: 12345,
    // Chosen so the arrival's tug-strike roll (10%) comes up clear.
    rng: 1,
    ships: [
      {
        id: "s1",
        name: "Kestrel",
        model: "tramp",
        condition: 80,
        fuel: 200,
        port: null,
        chartered: false,
        boughtDay: 1,
      },
    ],
    activeShipId: "s1",
    voyages: [],
    arrivals: [],
    phase: { kind: "operating" },
    log: [{ day: 1, text: "Seeded for the test.", tone: "info" }],
    stats: {
      voyages: 0,
      deliveredTons: 0,
      milesSailed: 0,
      rescues: 0,
      manualDockings: 0,
    },
    ...overrides,
  };
}

/** Replace the stored save through `PUT /saves/default`, then reload into it. */
async function seedSave(page: Page, state: Record<string, unknown>): Promise<void> {
  const failure = await page.evaluate(async (doc) => {
    const current = await fetch("/api/games/landfall/saves/default", {
      headers: { Accept: "application/json" },
    }).then((response) => (response.ok ? response.json() : null));

    const response = await fetch("/api/games/landfall/saves/default", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: doc,
        stateVersion: 3,
        ...(current ? { expectedRevision: current.revision } : {}),
      }),
    });
    return response.ok ? null : `${response.status} ${await response.text()}`;
  }, state);

  expect(failure).toBeNull();
  await page.reload();
}

test("founding a company lands in port with a freight market", async ({ page }) => {
  await page.goto("/landfall");

  await expect(page.getByRole("heading", { name: "Found the company" })).toBeVisible();

  await page.getByLabel("Company name").fill("Petrel & Sons");
  // Home port off the chip list, first hull off the used market.
  await page.getByRole("option", { name: "Singapore" }).click();
  await page.locator(".lf-offer").first().click();
  await page.getByRole("button", { name: "Sign the papers" }).click();

  await expect(page.getByRole("heading", { name: "Singapore freight market" })).toBeVisible();
  await expect(page.getByText("Petrel & Sons")).toBeVisible();
  // The market has cargo on the board, priced and destined.
  expect(await page.locator(".lf-contract").count()).toBeGreaterThan(0);
  await expect(page.getByTestId("lf-save-status")).toContainText("revision 1");

  // The whole company survives a reload — it lives in Postgres, not React.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Singapore freight market" })).toBeVisible();
});

test("a voyage arrives, takes the tug and banks the payment", async ({ page }) => {
  await page.goto("/landfall");
  await expect(page.getByRole("heading", { name: "Found the company" })).toBeVisible();

  // One day short of London with cargo under hatches.
  await seedSave(
    page,
    companyDocument({
      voyages: [
        {
          shipId: "s1",
          contract: {
            id: "seeded-1",
            cargo: "grain",
            tons: 6000,
            from: "rotterdam",
            to: "london",
            ratePerTon: 20,
            payment: 120_000,
            deadlineDay: null,
          },
          speed: 12,
          legs: ["rotterdam", "london"],
          distanceNm: 165,
          coveredNm: 150,
          dayAtSea: 1,
          piracy: 0,
          lostTons: 0,
          pendingEvent: null,
        },
      ],
    }),
  );

  await expect(page.getByRole("heading", { name: /Kestrel — Rotterdam to London/ })).toBeVisible();

  await page.getByRole("button", { name: "Sail on — one day" }).click();

  // Landfall: the docking choice, with working tugs (the dice are seeded).
  await expect(page.getByRole("heading", { name: /London roads/ })).toBeVisible();
  await page.getByTestId("lf-dock-tug").click();

  // Alongside: back in port, paid, and on the fortunes board.
  await expect(page.getByRole("heading", { name: "London freight market" })).toBeVisible();
  await page.getByRole("tab", { name: "Log" }).click();
  await expect(page.getByText(/6,000t of grain delivered in London/)).toBeVisible();

  await page.locator(".lf-fortunes summary").click();
  await expect(page.getByTestId("lf-fortunes").getByRole("listitem")).toHaveCount(1);

  // Lifetime stats are progression, not save state.
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const response = await fetch("/api/games/landfall/progress", {
          headers: { Accept: "application/json" },
        });
        const body = (await response.json()) as { stats: Record<string, number> };
        return body.stats["voyages"] ?? 0;
      }),
    )
    .toBe(1);
});

test("with the tugs on strike, the captain can hand over to the emergency tug", async ({
  page,
}) => {
  await page.goto("/landfall");
  await expect(page.getByRole("heading", { name: "Found the company" })).toBeVisible();

  await seedSave(
    page,
    companyDocument({
      arrivals: [
        {
          shipId: "s1",
          portId: "piraeus",
          contract: null,
          lostTons: 0,
          tugStrike: true,
        },
      ],
    }),
  );

  // No tug for hire today.
  await expect(page.getByText(/walked out this morning/)).toBeVisible();
  await expect(page.getByTestId("lf-dock-tug")).toBeDisabled();

  await page.getByTestId("lf-dock-manual").click();
  await expect(page.locator(".lf-sim__canvas")).toBeVisible();

  // Throwing in the towel costs a premium but ends alongside all the same.
  await page.getByRole("button", { name: /Give up — emergency tug/ }).click();
  await expect(page.getByRole("heading", { name: "Piraeus freight market" })).toBeVisible();
});

test("a save from a newer build is reported, not overwritten", async ({ page }) => {
  await page.goto("/landfall");
  await expect(page.getByRole("heading", { name: "Found the company" })).toBeVisible();

  const failure = await page.evaluate(async () => {
    const response = await fetch("/api/games/landfall/saves/default", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: { version: 4, coffee: "something this build has never seen" },
        stateVersion: 4,
      }),
    });
    return response.ok ? null : `${response.status} ${await response.text()}`;
  });
  expect(failure).toBeNull();

  await page.reload();

  await expect(page.getByText(/written by a different version/)).toBeVisible();
  // Still there, untouched, until the player founds a new company.
  const stored = await page.evaluate(async () => {
    const response = await fetch("/api/games/landfall/saves/default", {
      headers: { Accept: "application/json" },
    });
    return (await response.json()) as { stateVersion: number };
  });
  expect(stored.stateVersion).toBe(4);
});
