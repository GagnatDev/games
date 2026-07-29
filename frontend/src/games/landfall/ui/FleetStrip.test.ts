import { describe, expect, it } from "vitest";
import { shipStatus } from "./FleetStrip";
import { newGameState, type Arrival, type LandfallState, type Voyage } from "../state";

function company(): LandfallState {
  return newGameState({
    company: "Meridian Lines",
    homePort: "rotterdam",
    seed: 7,
    cash: 1_000_000,
    ship: { id: "s1", name: "Kestrel", model: "tramp", condition: 80, fuel: 200 },
  });
}

const passage = (overrides: Partial<Voyage> = {}): Voyage => ({
  shipId: "s1",
  contract: null,
  speed: 12,
  legs: ["rotterdam", "london"],
  distanceNm: 165,
  coveredNm: 40,
  dayAtSea: 1,
  piracy: 0,
  lostTons: 0,
  pendingEvent: null,
  ...overrides,
});

const inTheRoads = (overrides: Partial<Arrival> = {}): Arrival => ({
  shipId: "s1",
  portId: "london",
  contract: null,
  lostTons: 0,
  tugStrike: false,
  ...overrides,
});

describe("shipStatus", () => {
  it("names the port a ship is lying in", () => {
    const state = company();
    expect(shipStatus(state, state.ships[0]!)).toBe("in Rotterdam");
  });

  it("reports a ship under way as at sea", () => {
    const state: LandfallState = { ...company(), voyages: [passage()] };
    expect(shipStatus(state, state.ships[0]!)).toBe("at sea");
  });

  it("calls out a hull waiting on the captain", () => {
    const state: LandfallState = {
      ...company(),
      voyages: [passage({ pendingEvent: { kind: "storm" } })],
    };
    expect(shipStatus(state, state.ships[0]!)).toBe("needs the captain");
  });

  it("names the port for a ship in the roads", () => {
    const state: LandfallState = { ...company(), arrivals: [inTheRoads()] };
    expect(shipStatus(state, state.ships[0]!)).toBe("roads · London");
  });

  it("puts the roads ahead of a passage still on the books", () => {
    const state: LandfallState = {
      ...company(),
      voyages: [passage({ pendingEvent: { kind: "storm" } })],
      arrivals: [inTheRoads()],
    };
    expect(shipStatus(state, state.ships[0]!)).toBe("roads · London");
  });

  it("puts a charter ahead of everything — she is not ours to sail", () => {
    const state: LandfallState = {
      ...company(),
      ships: [{ ...company().ships[0]!, chartered: true }],
      voyages: [passage({ pendingEvent: { kind: "storm" } })],
    };
    expect(shipStatus(state, state.ships[0]!)).toBe("on charter");
  });

  it("counts down the days for a hull in the yard", () => {
    const state: LandfallState = {
      ...company(),
      refits: [{ shipId: "s1", points: 24, days: 2, daysLeft: 2 }],
    };
    expect(shipStatus(state, state.ships[0]!)).toBe("in the yard · 2 days to go");
    expect(
      shipStatus({ ...state, refits: [{ ...state.refits[0]!, daysLeft: 1 }] }, state.ships[0]!),
    ).toBe("in the yard · 1 day to go");
  });

  it("treats a ship with neither berth nor passage as away", () => {
    const state = company();
    expect(shipStatus(state, { ...state.ships[0]!, port: null })).toBe("at sea");
  });
});
