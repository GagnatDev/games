import { describe, expect, it } from "vitest";
import { shortestRoute } from "./nav";
import { repair } from "./calendar";
import { repairCostPerPoint } from "./economy";
import { depart } from "./voyage";
import { newGameState, type LandfallState, type Ship } from "./state";
import { shipModel } from "./world";

function company(overrides: Partial<LandfallState> = {}): LandfallState {
  const state = newGameState({
    company: "Meridian Lines",
    homePort: "rotterdam",
    seed: 12345,
    cash: 1_000_000,
    ship: { id: "s1", name: "Kestrel", model: "tramp", condition: 70, fuel: 280 },
  });
  return { ...state, ...overrides };
}

/** A sister lying alongside, ready to be sent to sea. */
function sister(): Ship {
  return {
    id: "s2",
    name: "Petrel",
    model: "tramp",
    condition: 80,
    fuel: 280,
    port: "rotterdam",
    chartered: false,
    boughtDay: 1,
  };
}

/** `company()` with a sister alongside her. */
function withSister(): LandfallState {
  const state = company();
  return { ...state, ships: [...state.ships, sister()] };
}

function sendToSea(state: LandfallState, ship: Ship): LandfallState {
  return depart(state, {
    ship,
    contract: null,
    route: shortestRoute("rotterdam", "new-york")!,
    speed: 12,
  });
}

const yardBillFor = (points: number) => points * repairCostPerPoint(shipModel("tramp"));

describe("yard work", () => {
  it("costs money, mends the hull and spends the days", () => {
    const state = company();
    const mended = repair(state, "s1", 24);
    expect(mended.ships[0]!.condition).toBe(94);
    expect(mended.day).toBe(state.day + 2); // 24 points → two days in dock
    expect(mended.log[mended.log.length - 1]!.text).toMatch(/2 days in the yard/);
  });

  it("charges the yard bill and the days' running costs on top", () => {
    const state = company();
    const spent = state.cash - repair(state, "s1", 24).cash;
    // Wages and harbour dues run for the two yard days as well as the bill.
    expect(spent).toBeGreaterThan(yardBillFor(24));
    expect(spent).toBeLessThan(yardBillFor(24) + 2 * 200_000);
  });

  it("says 'day' for a single day in dock", () => {
    const state = company();
    const mended = repair(state, "s1", 6);
    expect(mended.day).toBe(state.day + 1);
    expect(mended.log[mended.log.length - 1]!.text).toMatch(/1 day in the yard/);
  });

  /**
   * The whole reason this lives above `economy.ts`: yard time is company time,
   * so a sister at sea has to make ground while the first is in dock.
   */
  it("sails the rest of the fleet on while she is in dock", () => {
    const state = sendToSea(withSister(), withSister().ships[1]!);
    expect(state.voyages).toHaveLength(1);

    const mended = repair(state, "s1", 24);
    expect(mended.day).toBe(state.day + 2);
    // Two days in dock, two days of sea room for her sister.
    expect(mended.voyages[0]!.dayAtSea).toBe(2);
    expect(mended.voyages[0]!.coveredNm).toBeGreaterThan(0);
  });

  it("refuses while a noon report holds the calendar", () => {
    const sailing = sendToSea(withSister(), withSister().ships[1]!);
    const held: LandfallState = {
      ...sailing,
      voyages: sailing.voyages.map((v) => ({ ...v, pendingEvent: { kind: "storm" } as const })),
    };

    // No cash spent, no condition gained, no day turned.
    expect(repair(held, "s1", 24)).toBe(held);
  });

  it("does nothing for a ship that needs no work, is unknown, or is at sea", () => {
    const sound = company({ ships: [{ ...company().ships[0]!, condition: 100 }] });
    expect(repair(sound, "s1", 10)).toBe(sound);

    const state = company();
    expect(repair(state, "nobody", 10)).toBe(state);

    const atSea = sendToSea(state, state.ships[0]!);
    expect(repair(atSea, "s1", 10)).toBe(atSea);
  });

  it("never mends past a sound hull", () => {
    const worn = company({ ships: [{ ...company().ships[0]!, condition: 95 }] });
    const mended = repair(worn, "s1", 40);
    expect(mended.ships[0]!.condition).toBe(100);
    expect(mended.day).toBe(worn.day + 1); // 5 points is one day, not four
  });
});
