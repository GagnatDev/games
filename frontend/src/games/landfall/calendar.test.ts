import { describe, expect, it } from "vitest";
import { shortestRoute } from "./nav";
import { beginRefit, tickRefits } from "./calendar";
import { repairCostPerPoint, sellShip, setChartered } from "./economy";
import { advanceDay, depart } from "./voyage";
import { newGameState, refitOf, type LandfallState, type Ship } from "./state";
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

/** Spend `count` days of company time the way the captain would. */
function wait(state: LandfallState, count: number): LandfallState {
  let next = state;
  for (let i = 0; i < count; i += 1) next = advanceDay(next);
  return next;
}

const yardBillFor = (points: number) => points * repairCostPerPoint(shipModel("tramp"));

describe("booking a ship into the yard", () => {
  it("charges the bill and locks her in dock without turning the calendar", () => {
    const state = company();
    const booked = beginRefit(state, "s1", 24);

    expect(booked.day).toBe(state.day); // 24 points → two days, none of them spent yet
    expect(booked.cash).toBe(state.cash - yardBillFor(24));
    expect(booked.ships[0]!.condition).toBe(70); // the plates go on when she comes out
    expect(refitOf(booked, "s1")).toEqual({
      shipId: "s1",
      points: 24,
      days: 2,
      daysLeft: 2,
    });
    expect(booked.log[booked.log.length - 1]!.text).toMatch(/into the yard — 2 days in dock/);
  });

  it("says 'day' for a single day in dock", () => {
    const booked = beginRefit(company(), "s1", 6);
    expect(refitOf(booked, "s1")?.days).toBe(1);
    expect(booked.log[booked.log.length - 1]!.text).toMatch(/1 day in dock/);
  });

  it("never quotes past a sound hull", () => {
    const worn = company({ ships: [{ ...company().ships[0]!, condition: 95 }] });
    const booked = beginRefit(worn, "s1", 40);
    // 5 points is one day and one day's bill, not four.
    expect(refitOf(booked, "s1")).toMatchObject({ points: 5, days: 1 });
    expect(booked.cash).toBe(worn.cash - yardBillFor(5));
  });

  it("goes ahead while a noon report elsewhere holds the clock", () => {
    const sailing = sendToSea(withSister(), sister());
    const held: LandfallState = {
      ...sailing,
      voyages: sailing.voyages.map((v) => ({ ...v, pendingEvent: { kind: "storm" } as const })),
    };

    // Nothing about the yard needs the calendar any more, so the job is taken.
    const booked = beginRefit(held, "s1", 24);
    expect(refitOf(booked, "s1")).toBeDefined();
    expect(booked.day).toBe(held.day);
  });

  it("does nothing for a ship that needs no work, is unknown, is at sea or is on charter", () => {
    const sound = company({ ships: [{ ...company().ships[0]!, condition: 100 }] });
    expect(beginRefit(sound, "s1", 10)).toBe(sound);

    const state = company();
    expect(beginRefit(state, "nobody", 10)).toBe(state);

    const atSea = sendToSea(state, state.ships[0]!);
    expect(beginRefit(atSea, "s1", 10)).toBe(atSea);

    const onCharter = setChartered(state, "s1", true);
    expect(beginRefit(onCharter, "s1", 10)).toBe(onCharter);
  });

  it("refuses a second job on a hull the yard already has", () => {
    const booked = beginRefit(company(), "s1", 12);
    expect(beginRefit(booked, "s1", 12)).toBe(booked);
  });
});

describe("a ship in dock", () => {
  it("comes out mended on the day the work runs out", () => {
    const booked = beginRefit(company(), "s1", 24);

    const midway = advanceDay(booked);
    expect(refitOf(midway, "s1")?.daysLeft).toBe(1);
    expect(midway.ships[0]!.condition).toBe(70);

    const out = advanceDay(midway);
    expect(refitOf(out, "s1")).toBeUndefined();
    expect(out.ships[0]!.condition).toBe(94);
    expect(out.day).toBe(booked.day + 2);
    expect(out.log[out.log.length - 1]!.text).toMatch(/out of the yard after 2 days/);
  });

  it("never mends past a sound hull", () => {
    const worn = company({ ships: [{ ...company().ships[0]!, condition: 95 }] });
    const out = wait(beginRefit(worn, "s1", 40), 1);
    expect(out.ships[0]!.condition).toBe(100);
  });

  it("cannot sail, be chartered or be sold until she is out", () => {
    const booked = beginRefit(company(), "s1", 24);
    const ship = booked.ships[0]!;

    expect(sendToSea(booked, ship)).toBe(booked);
    expect(setChartered(booked, "s1", true)).toBe(booked);
    expect(sellShip(booked, "s1")).toBe(booked);

    // Out of dock, she is the captain's again.
    const out = wait(booked, 2);
    expect(sendToSea(out, out.ships[0]!).voyages).toHaveLength(1);
  });

  /**
   * The point of the whole change: the days belong to the captain. A sister
   * makes ground, the freight board rolls, and the hull in dock waits.
   */
  it("holds nobody else up — sisters sail and the board rolls on", () => {
    const sailing = sendToSea(withSister(), sister());
    const booked = beginRefit(sailing, "s1", 24);
    expect(booked.voyages[0]!.dayAtSea).toBe(0);

    const later = wait(booked, 2);
    expect(later.day).toBe(booked.day + 2);
    expect(later.voyages[0]!.dayAtSea).toBe(2);
    expect(later.voyages[0]!.coveredNm).toBeGreaterThan(0);
    expect(later.ships[0]!.condition).toBe(94);
  });

  it("still runs up wages and harbour dues while she lies there", () => {
    const booked = beginRefit(company(), "s1", 24);
    const out = wait(booked, 2);
    const spent = company().cash - out.cash;
    expect(spent).toBeGreaterThan(yardBillFor(24));
    expect(spent).toBeLessThan(yardBillFor(24) + 2 * 200_000);
  });
});

describe("tickRefits", () => {
  it("leaves a company with an empty dock exactly as it was", () => {
    const state = company();
    expect(tickRefits(state)).toBe(state);
  });

  it("strikes off a job whose hull has left the fleet", () => {
    const twoShips = withSister();
    const booked = beginRefit(twoShips, "s1", 24);
    const gone: LandfallState = { ...booked, ships: [sister()] };
    expect(tickRefits(gone).refits).toEqual([]);
  });
});
