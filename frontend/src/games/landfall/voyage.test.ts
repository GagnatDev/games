import { describe, expect, it } from "vitest";
import { shipModel } from "./world";
import { shortestRoute } from "./nav";
import { newGameState, type Contract, type LandfallState, type Ship } from "./state";
import {
  advanceDay,
  canCarry,
  completeArrival,
  dayIsBlocked,
  depart,
  estimateVoyage,
  fuelNeeded,
  resolveEvent,
  routeTolls,
  voyageDays,
} from "./voyage";

function company(cash = 1_000_000): LandfallState {
  return newGameState({
    company: "Meridian Lines",
    homePort: "rotterdam",
    seed: 777,
    cash,
    ship: {
      id: "s1",
      name: "Kestrel",
      model: "tramp",
      condition: 85,
      fuel: 280,
    },
  });
}

/** A sister ship lying alongside in `company()`'s home port. */
function secondShip(id = "s2", name = "Petrel"): Ship {
  return {
    id,
    name,
    model: "tramp",
    condition: 80,
    fuel: 280,
    port: "rotterdam",
    chartered: false,
    boughtDay: 1,
  };
}

/** `company()` plus however many sister ships the test needs. */
function fleet(ships: Ship[], cash = 1_000_000): LandfallState {
  const state = company(cash);
  return { ...state, ships: [...state.ships, ...ships] };
}

function contractTo(to: string, tons = 6000, id = "c1"): Contract {
  return {
    id,
    cargo: "grain",
    tons,
    from: "rotterdam",
    to,
    ratePerTon: 20,
    payment: tons * 20,
    deadlineDay: null,
  };
}

/** Cast off. Named options because four bare strings in a row read as noise. */
function sail(
  state: LandfallState,
  opts: { ship?: Ship; to?: string; contractId?: string; speed?: number } = {},
): LandfallState {
  const ship = opts.ship ?? state.ships[0]!;
  const to = opts.to ?? "london";
  const route = shortestRoute(ship.port ?? "rotterdam", to)!;
  return depart(state, {
    ship,
    contract: contractTo(to, 6000, opts.contractId ?? "c1"),
    route,
    speed: opts.speed ?? 12,
  });
}

describe("planning", () => {
  it("does the days-and-fuel arithmetic", () => {
    expect(voyageDays(2880, 12)).toBe(10);
    const model = shipModel("tramp");
    // At cruise speed the curve passes exactly through the model's figure.
    expect(fuelNeeded("tramp", 2880, model.cruiseSpeed)).toBe(
      Math.ceil(voyageDays(2880, model.cruiseSpeed) * model.fuelPerDay),
    );
    // Ten per cent more speed costs well over ten per cent more fuel.
    expect(fuelNeeded("tramp", 2880, 14.4)).toBeGreaterThan(
      fuelNeeded("tramp", 2880, 12) * 1.1,
    );
  });

  it("prices canal passages into the estimate", () => {
    const state = company();
    const suez = shortestRoute("rotterdam", "dubai")!;
    const tolls = routeTolls(suez, shipModel("tramp").dwt);
    expect(tolls).toBeGreaterThan(0);
    const estimate = estimateVoyage(state.ships[0]!, contractTo("dubai"), suez, 12);
    expect(estimate.tolls).toBe(tolls);
    expect(estimate.runningCosts).toBeGreaterThan(tolls);
  });

  it("rejects cargo the hold cannot take", () => {
    const state = company();
    expect(canCarry(state.ships[0]!, contractTo("london", 6000))).toBeNull();
    expect(canCarry(state.ships[0]!, contractTo("london", 60_000))).toMatch(/not fit/);
    expect(
      canCarry(state.ships[0]!, { ...contractTo("london"), cargo: "crude-oil" }),
    ).toMatch(/no hold/);
  });
});

describe("a day at sea", () => {
  it("advances the track, burns fuel and ticks the ledger", () => {
    const state = sail(company());
    expect(state.phase.kind).toBe("operating");
    expect(state.voyages).toHaveLength(1);
    expect(state.ships[0]!.port).toBeNull();

    const next = advanceDay(state);
    expect(next.day).toBe(state.day + 1);
    expect(next.ships[0]!.fuel).toBeLessThan(state.ships[0]!.fuel);
    if (next.voyages[0]) {
      expect(next.voyages[0].dayAtSea).toBe(1);
      expect(next.voyages[0].coveredNm).toBeGreaterThan(0);
    } else {
      // Rotterdam–London is short; same-day arrival is legitimate.
      expect(next.arrivals).toHaveLength(1);
    }
  });

  it("is deterministic from the saved dice", () => {
    const state = sail(company());
    expect(advanceDay(state)).toEqual(advanceDay(state));
  });

  it("waits for the captain while a noon report is open", () => {
    let state = sail(company());
    const voyage = state.voyages[0];
    if (!voyage) throw new Error("expected a voyage");
    state = {
      ...state,
      voyages: [{ ...voyage, pendingEvent: { kind: "storm" } }],
    };
    expect(dayIsBlocked(state)).toBe(true);
    expect(advanceDay(state)).toBe(state);
  });

  it("loses way when the ship heaves to in a storm", () => {
    let state = sail(company());
    state = advanceDay(state);
    const voyage = state.voyages[0];
    if (!voyage) return;
    const covered = voyage.coveredNm;
    state = {
      ...state,
      voyages: [{ ...voyage, pendingEvent: { kind: "storm" } }],
    };
    const rode = resolveEvent(state, "heave-to", voyage.shipId);
    const after = rode.voyages[0];
    if (!after) throw new Error("expected a voyage");
    expect(after.pendingEvent).toBeNull();
    expect(after.coveredNm).toBeLessThan(covered);
  });

  it("calls the tow when the bunkers run dry", () => {
    let state = sail(company());
    const voyage = state.voyages[0];
    if (!voyage) throw new Error("expected a voyage");
    // Swap in a long route with nothing in the tank.
    const route = shortestRoute("rotterdam", "new-york")!;
    state = {
      ...state,
      ships: state.ships.map((s) => ({ ...s, fuel: 5 })),
      voyages: [
        {
          ...voyage,
          legs: [...route.legs],
          distanceNm: route.distanceNm,
        },
      ],
    };
    const next = advanceDay(state);
    expect(next.voyages[0]?.pendingEvent?.kind).toBe("fuel");

    const towed = resolveEvent(next, "acknowledge", "s1");
    expect(towed.arrivals).toHaveLength(1);
    expect(towed.voyages).toHaveLength(0);
    expect(towed.cash).toBeLessThan(next.cash);
  });
});

describe("the whole passage", () => {
  it("sails Rotterdam to London, docks and gets paid", () => {
    let state = sail(company());

    for (let i = 0; i < 60 && state.voyages.length > 0; i += 1) {
      const pending = state.voyages[0]?.pendingEvent;
      state = pending
        ? resolveEvent(
            state,
            pending.kind === "storm" ? "heave-to" : "pay-tribute",
            "s1",
          )
        : advanceDay(state);
    }

    expect(state.arrivals).toHaveLength(1);
    expect(state.arrivals[0]!.portId).toBe("london");

    const cashBefore = state.cash;
    const done = completeArrival(state, { method: "tug", damage: 0, emergencyTow: false }, "s1");
    expect(done.phase.kind).toBe("operating");
    expect(done.arrivals).toHaveLength(0);
    expect(done.ships[0]!.port).toBe("london");
    expect(done.stats.voyages).toBe(1);
    expect(done.stats.milesSailed).toBeGreaterThan(0);
    // Payment beats the tug and port fees on this contract by design.
    expect(done.cash).toBeGreaterThan(cashBefore);
  });

  it("docks clean by hand for a nod from the harbourmaster", () => {
    let state = sail(company());
    for (let i = 0; i < 60 && state.voyages.length > 0; i += 1) {
      state = state.voyages[0]?.pendingEvent
        ? resolveEvent(state, "heave-to", "s1")
        : advanceDay(state);
    }
    expect(state.arrivals).toHaveLength(1);

    const done = completeArrival(
      state,
      { method: "manual", damage: 0, emergencyTow: false },
      "s1",
    );
    expect(done.stats.manualDockings).toBe(1);
  });

  it("winds the company up when the quay bills sink it", () => {
    let state = sail(company(1000));
    // Deep in debt: the ship is worthless and the fees will not be covered.
    state = {
      ...state,
      loan: 10_000_000,
      ships: state.ships.map((s) => ({ ...s, condition: 1 })),
    };
    for (let i = 0; i < 60 && state.voyages.length > 0; i += 1) {
      state = state.voyages[0]?.pendingEvent
        ? resolveEvent(state, "heave-to", "s1")
        : advanceDay(state);
    }
    expect(state.arrivals).toHaveLength(1);
    const done = completeArrival(state, { method: "tug", damage: 0, emergencyTow: false }, "s1");
    expect(done.phase.kind).toBe("bankrupt");
  });
});

describe("parallel freights", () => {
  it("lets a second ship cast off while the first is still at sea", () => {
    let state = fleet([secondShip()]);

    state = sail(state, { ship: state.ships[0]!, to: "new-york", contractId: "c-a" });
    expect(state.voyages).toHaveLength(1);
    expect(state.ships[0]!.port).toBeNull();
    expect(state.ships[1]!.port).toBe("rotterdam");

    // Switch command and take another contract out of the same port.
    state = { ...state, activeShipId: "s2" };
    state = sail(state, { ship: state.ships[1]!, to: "london", contractId: "c-b" });

    expect(state.phase.kind).toBe("operating");
    expect(state.voyages).toHaveLength(2);
    expect(state.ships.every((s) => s.port === null)).toBe(true);
  });

  it("advances every ship under way on the same company day", () => {
    let state = fleet([secondShip()]);
    state = sail(state, { ship: state.ships[0]!, to: "new-york", contractId: "c-a" });
    state = sail(state, { ship: state.ships[1]!, to: "singapore", contractId: "c-b" });

    const next = advanceDay(state);
    expect(next.day).toBe(state.day + 1);
    expect(next.voyages).toHaveLength(2);
    for (const voyage of next.voyages) {
      expect(voyage.dayAtSea).toBe(1);
      expect(voyage.coveredNm).toBeGreaterThan(0);
    }
  });

  it("refuses the same market lot twice", () => {
    let state = fleet([secondShip()]);
    const lot = contractTo("london", 6000, "shared");
    const route = shortestRoute("rotterdam", "london")!;

    state = depart(state, {
      ship: state.ships[0]!,
      contract: lot,
      route,
      speed: 12,
    });
    const again = depart(state, {
      ship: state.ships[1]!,
      contract: lot,
      route,
      speed: 12,
    });
    expect(again.voyages).toHaveLength(1);
    expect(again).toBe(state);
  });

  /**
   * Two hulls making port on one tick is the path the day loop is easiest to
   * get wrong: each arrival rolls for a tug strike, and both rolls have to come
   * off the same advancing dice rather than the value the day started with.
   */
  it("puts two ships that make port on the same day into the roads", () => {
    let state = fleet([secondShip()]);
    state = sail(state, { ship: state.ships[0]!, to: "london", contractId: "c-a" });
    state = sail(state, { ship: state.ships[1]!, to: "london", contractId: "c-b" });
    expect(state.voyages).toHaveLength(2);

    // Rotterdam–London is one short hop, so both arrive on the first tick.
    const next = advanceDay(state);
    expect(next.voyages).toEqual([]);
    expect(next.arrivals).toHaveLength(2);
    expect(next.arrivals.map((a) => a.shipId).sort()).toEqual(["s1", "s2"]);
    expect(next.arrivals.every((a) => a.portId === "london")).toBe(true);
    // Both passages counted, not just the last one home.
    expect(next.stats.milesSailed).toBe(
      Math.round(state.voyages[0]!.distanceNm + state.voyages[1]!.distanceNm),
    );
  });

  /**
   * Two identical sisters on the same passage: nothing but the dice can tell
   * them apart. If the day loop replayed the day's opening roll for every hull
   * instead of threading one advancing dice through them, they would report the
   * same weather and cover the same ground forever.
   */
  it("gives each hull its own rolls rather than replaying the day's dice", () => {
    const twin: Ship = { ...secondShip("s2", "Kestrel II"), condition: 85, fuel: 280 };
    let state = fleet([twin]);
    state = sail(state, { ship: state.ships[0]!, to: "singapore", contractId: "c-a" });
    state = sail(state, { ship: state.ships[1]!, to: "singapore", contractId: "c-b" });
    expect(state.voyages).toHaveLength(2);

    for (let day = 0; day < 30; day += 1) {
      // Answer nothing — clear both reports so the calendar keeps turning.
      state = {
        ...state,
        voyages: state.voyages.map((v) => ({ ...v, pendingEvent: null })),
      };
      state = advanceDay(state);
      if (state.voyages.length < 2) break;
      const [a, b] = state.voyages;
      if (a!.coveredNm !== b!.coveredNm) return;
      if (a!.pendingEvent?.kind !== b!.pendingEvent?.kind) return;
    }
    throw new Error("the sisters never diverged — the hulls appear to share one roll");
  });

  it("sails one hull on while a sister is already in the roads", () => {
    let state = fleet([secondShip()]);
    state = sail(state, { ship: state.ships[0]!, to: "london", contractId: "c-a" });
    state = sail(state, { ship: state.ships[1]!, to: "new-york", contractId: "c-b" });

    const next = advanceDay(state);
    expect(next.arrivals.map((a) => a.shipId)).toEqual(["s1"]);
    expect(next.voyages.map((v) => v.shipId)).toEqual(["s2"]);
    expect(next.voyages[0]!.dayAtSea).toBe(1);

    // The long passage keeps ticking on later days without disturbing the
    // roads. Clear any noon report first — one open report holds the fleet.
    const clear = { ...next, voyages: next.voyages.map((v) => ({ ...v, pendingEvent: null })) };
    const later = advanceDay(clear);
    expect(later.arrivals.map((a) => a.shipId)).toEqual(["s1"]);
    expect(later.voyages[0]!.dayAtSea).toBe(2);
  });

  it("advances the fleet deterministically from the same save", () => {
    let state = fleet([secondShip()]);
    state = sail(state, { ship: state.ships[0]!, to: "new-york", contractId: "c-a" });
    state = sail(state, { ship: state.ships[1]!, to: "singapore", contractId: "c-b" });
    expect(advanceDay(state)).toEqual(advanceDay(state));
  });

  it("strikes off a passage whose hull has left the fleet", () => {
    let state = fleet([secondShip()]);
    state = sail(state, { ship: state.ships[0]!, to: "new-york", contractId: "c-a" });
    state = sail(state, { ship: state.ships[1]!, to: "singapore", contractId: "c-b" });

    // Sell the second ship out from under her passage.
    state = { ...state, ships: state.ships.filter((s) => s.id !== "s2") };

    const next = advanceDay(state);
    expect(next.voyages.map((v) => v.shipId)).toEqual(["s1"]);
    expect(next.log.some((entry) => entry.text.includes("struck off"))).toBe(true);

    // And she stays struck off rather than reappearing every day.
    expect(advanceDay(next).voyages.map((v) => v.shipId)).toEqual(["s1"]);
  });
});
