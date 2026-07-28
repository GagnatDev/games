import { describe, expect, it } from "vitest";
import {
  MAX_LOG,
  STATE_VERSION,
  activeFocus,
  activeShip,
  landfallStateSchema,
  logged,
  newGameState,
  parseState,
  replaceShip,
} from "./state";

function fresh() {
  return newGameState({
    company: "Meridian Lines",
    homePort: "rotterdam",
    seed: 99,
    cash: 2_000_000,
    ship: { id: "s1", name: "Kestrel", model: "tramp", condition: 70, fuel: 120 },
  });
}

describe("a new company", () => {
  it("passes its own schema", () => {
    expect(landfallStateSchema.safeParse(fresh()).success).toBe(true);
  });

  it("starts operating in port with one ship and a founding log entry", () => {
    const state = fresh();
    expect(state.phase).toEqual({ kind: "operating" });
    expect(state.voyages).toEqual([]);
    expect(state.arrivals).toEqual([]);
    expect(state.ships).toHaveLength(1);
    expect(activeShip(state)?.port).toBe("rotterdam");
    expect(activeFocus(state)).toBe("operating");
    expect(state.log[0]!.text).toMatch(/founded/);
  });
});

describe("parseState", () => {
  it("round-trips a valid document", () => {
    const state = fresh();
    expect(parseState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it("reports the version-1 shell save as unreadable, not resettable", () => {
    const shellSave = {
      version: 1,
      captain: { port: "oslo", cash: 250_000 },
      log: [{ at: "2026-01-01T00:00:00.000Z", note: "deploy check" }],
    };
    expect(parseState(shellSave)).toBeNull();
  });

  it("migrates a v2 mid-voyage save onto the fleet lists", () => {
    const v2 = {
      version: 2,
      company: "Old Lines",
      homePort: "rotterdam",
      day: 4,
      cash: 800_000,
      loan: 0,
      reputation: 50,
      seed: 1,
      rng: 2,
      ships: [
        {
          id: "s1",
          name: "Kestrel",
          model: "tramp",
          condition: 80,
          fuel: 100,
          port: null,
          chartered: false,
          boughtDay: 1,
        },
      ],
      activeShipId: "s1",
      phase: {
        kind: "voyage",
        voyage: {
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
        },
      },
      log: [{ day: 1, text: "hi", tone: "info" }],
      stats: {
        voyages: 0,
        deliveredTons: 0,
        milesSailed: 0,
        rescues: 0,
        manualDockings: 0,
      },
    };
    const migrated = parseState(v2);
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(STATE_VERSION);
    expect(migrated!.phase).toEqual({ kind: "operating" });
    expect(migrated!.voyages).toHaveLength(1);
    expect(migrated!.voyages[0]!.shipId).toBe("s1");
    expect(migrated!.arrivals).toEqual([]);
    expect(activeFocus(migrated!)).toBe("voyage");
  });

  it("rejects a future version and junk", () => {
    expect(parseState({ ...fresh(), version: STATE_VERSION + 1 })).toBeNull();
    expect(parseState("not even an object")).toBeNull();
    expect(parseState({ ...fresh(), sneaky: true })).toBeNull();
  });
});

describe("helpers", () => {
  it("caps the log", () => {
    let state = fresh();
    for (let i = 0; i < MAX_LOG + 20; i += 1) {
      state = logged(state, `entry ${i}`);
    }
    expect(state.log).toHaveLength(MAX_LOG);
    expect(state.log[state.log.length - 1]!.text).toBe(`entry ${MAX_LOG + 19}`);
  });

  it("replaces a ship by id", () => {
    const state = fresh();
    const next = replaceShip(state, { ...state.ships[0]!, fuel: 1 });
    expect(next.ships[0]!.fuel).toBe(1);
    expect(state.ships[0]!.fuel).toBe(120);
  });
});
