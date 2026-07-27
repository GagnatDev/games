import { describe, expect, it } from "vitest";
import { shipModel } from "./world";
import { shortestRoute } from "./nav";
import { newGameState, type Contract, type LandfallState } from "./state";
import {
  advanceDay,
  canCarry,
  completeArrival,
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

function contractTo(to: string, tons = 6000): Contract {
  return {
    id: "c1",
    cargo: "grain",
    tons,
    from: "rotterdam",
    to,
    ratePerTon: 20,
    payment: tons * 20,
    deadlineDay: null,
  };
}

function sail(state: LandfallState): LandfallState {
  const route = shortestRoute("rotterdam", "london")!;
  return depart(state, {
    ship: state.ships[0]!,
    contract: contractTo("london"),
    route,
    speed: 12,
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
    expect(state.phase.kind).toBe("voyage");
    expect(state.ships[0]!.port).toBeNull();

    const next = advanceDay(state);
    expect(next.day).toBe(state.day + 1);
    expect(next.ships[0]!.fuel).toBeLessThan(state.ships[0]!.fuel);
    if (next.phase.kind === "voyage") {
      expect(next.phase.voyage.dayAtSea).toBe(1);
      expect(next.phase.voyage.coveredNm).toBeGreaterThan(0);
    } else {
      // Rotterdam–London is short; same-day arrival is legitimate.
      expect(next.phase.kind).toBe("docking");
    }
  });

  it("is deterministic from the saved dice", () => {
    const state = sail(company());
    expect(advanceDay(state)).toEqual(advanceDay(state));
  });

  it("waits for the captain while a noon report is open", () => {
    let state = sail(company());
    if (state.phase.kind !== "voyage") throw new Error("expected a voyage");
    state = {
      ...state,
      phase: {
        kind: "voyage",
        voyage: { ...state.phase.voyage, pendingEvent: { kind: "storm" } },
      },
    };
    expect(advanceDay(state)).toBe(state);
  });

  it("loses way when the ship heaves to in a storm", () => {
    let state = sail(company());
    state = advanceDay(state);
    if (state.phase.kind !== "voyage") return;
    const covered = state.phase.voyage.coveredNm;
    state = {
      ...state,
      phase: {
        kind: "voyage",
        voyage: { ...state.phase.voyage, pendingEvent: { kind: "storm" } },
      },
    };
    const rode = resolveEvent(state, "heave-to");
    if (rode.phase.kind !== "voyage") throw new Error("expected a voyage");
    expect(rode.phase.voyage.pendingEvent).toBeNull();
    expect(rode.phase.voyage.coveredNm).toBeLessThan(covered);
  });

  it("calls the tow when the bunkers run dry", () => {
    let state = sail(company());
    if (state.phase.kind !== "voyage") throw new Error("expected a voyage");
    // Swap in a long route with nothing in the tank.
    const route = shortestRoute("rotterdam", "new-york")!;
    state = {
      ...state,
      ships: state.ships.map((s) => ({ ...s, fuel: 5 })),
      phase: {
        kind: "voyage",
        voyage: {
          ...state.phase.voyage,
          legs: [...route.legs],
          distanceNm: route.distanceNm,
        },
      },
    };
    const next = advanceDay(state);
    if (next.phase.kind !== "voyage") throw new Error("expected a voyage");
    expect(next.phase.voyage.pendingEvent?.kind).toBe("fuel");

    const towed = resolveEvent(next, "acknowledge");
    expect(towed.phase.kind).toBe("docking");
    expect(towed.cash).toBeLessThan(next.cash);
  });
});

describe("the whole passage", () => {
  it("sails Rotterdam to London, docks and gets paid", () => {
    let state = sail(company());

    for (let i = 0; i < 60 && state.phase.kind === "voyage"; i += 1) {
      state = state.phase.voyage.pendingEvent
        ? resolveEvent(
            state,
            state.phase.voyage.pendingEvent.kind === "storm" ? "heave-to" : "pay-tribute",
          )
        : advanceDay(state);
    }

    expect(state.phase.kind).toBe("docking");
    if (state.phase.kind !== "docking") return;
    expect(state.phase.arrival.portId).toBe("london");

    const cashBefore = state.cash;
    const done = completeArrival(state, { method: "tug", damage: 0, emergencyTow: false });
    expect(done.phase.kind).toBe("port");
    expect(done.ships[0]!.port).toBe("london");
    expect(done.stats.voyages).toBe(1);
    expect(done.stats.milesSailed).toBeGreaterThan(0);
    // Payment beats the tug and port fees on this contract by design.
    expect(done.cash).toBeGreaterThan(cashBefore);
  });

  it("docks clean by hand for a nod from the harbourmaster", () => {
    let state = sail(company());
    for (let i = 0; i < 60 && state.phase.kind === "voyage"; i += 1) {
      state = state.phase.voyage.pendingEvent
        ? resolveEvent(state, "heave-to")
        : advanceDay(state);
    }
    if (state.phase.kind !== "docking") throw new Error("expected docking");

    const done = completeArrival(state, { method: "manual", damage: 0, emergencyTow: false });
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
    for (let i = 0; i < 60 && state.phase.kind === "voyage"; i += 1) {
      state = state.phase.voyage.pendingEvent
        ? resolveEvent(state, "heave-to")
        : advanceDay(state);
    }
    if (state.phase.kind !== "docking") throw new Error("expected docking");
    const done = completeArrival(state, { method: "tug", damage: 0, emergencyTow: false });
    expect(done.phase.kind).toBe("bankrupt");
  });
});
