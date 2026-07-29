import { describe, expect, it } from "vitest";
import {
  MAX_LOG,
  STATE_VERSION,
  activeShip,
  bridgeView,
  committedContractIds,
  landfallStateSchema,
  logged,
  newGameState,
  parseState,
  refitOf,
  replaceShip,
  type Contract,
  type LandfallState,
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

/** A v2 passage for the phase-shaped saves the old build wrote. */
const v2Voyage = {
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
} as const;

/** A schema-valid v2 save; `overrides` bends whichever field a test is about. */
function v2Save(overrides: Record<string, unknown> = {}) {
  return {
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
    phase: { kind: "port" } as unknown,
    log: [{ day: 1, text: "hi", tone: "info" }],
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

/**
 * A schema-valid v3 save: the current document before the yard kept a dock list.
 * Derived from a live one so it cannot drift out of step with the real schema.
 */
function v3Save(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { refits: _refits, ...carried } = fresh();
  return { ...carried, version: 3, ...overrides };
}

describe("a new company", () => {
  it("passes its own schema", () => {
    expect(landfallStateSchema.safeParse(fresh()).success).toBe(true);
  });

  it("starts in port with one ship and a founding log entry", () => {
    const state = fresh();
    expect(state.phase).toEqual({ kind: "operating" });
    expect(state.voyages).toEqual([]);
    expect(state.arrivals).toEqual([]);
    expect(state.refits).toEqual([]);
    expect(state.ships).toHaveLength(1);
    expect(activeShip(state)?.port).toBe("rotterdam");
    expect(bridgeView(state)).toBe("port");
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
    const migrated = parseState(v2Save({ phase: v2Voyage }));
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(STATE_VERSION);
    expect(migrated!.phase).toEqual({ kind: "operating" });
    expect(migrated!.voyages).toHaveLength(1);
    expect(migrated!.voyages[0]!.shipId).toBe("s1");
    expect(migrated!.arrivals).toEqual([]);
    expect(bridgeView(migrated!)).toBe("voyage");
  });

  it("migrates a v2 docking save into the roads", () => {
    const migrated = parseState(
      v2Save({
        phase: {
          kind: "docking",
          arrival: {
            shipId: "s1",
            portId: "london",
            contract: null,
            lostTons: 0,
            tugStrike: true,
          },
        },
      }),
    );
    expect(migrated!.phase).toEqual({ kind: "operating" });
    expect(migrated!.arrivals).toHaveLength(1);
    expect(migrated!.arrivals[0]!.portId).toBe("london");
    expect(migrated!.voyages).toEqual([]);
    expect(bridgeView(migrated!)).toBe("docking");
  });

  it("migrates a v2 save in port with nothing under way", () => {
    const migrated = parseState(v2Save({ phase: { kind: "port" } }));
    expect(migrated!.phase).toEqual({ kind: "operating" });
    expect(migrated!.voyages).toEqual([]);
    expect(migrated!.arrivals).toEqual([]);
    expect(bridgeView(migrated!)).toBe("port");
  });

  it("carries a wound-up v2 company through as bankrupt", () => {
    const migrated = parseState(
      v2Save({ phase: { kind: "bankrupt", day: 9, finalNetWorth: -50_000 } }),
    );
    expect(migrated!.phase).toEqual({ kind: "bankrupt", day: 9, finalNetWorth: -50_000 });
    expect(bridgeView(migrated!)).toBe("bankrupt");
  });

  it("carries every shared field across unchanged", () => {
    const migrated = parseState(v2Save({ phase: v2Voyage }))!;
    const original = v2Save({ phase: v2Voyage });
    for (const field of [
      "company",
      "homePort",
      "day",
      "cash",
      "loan",
      "reputation",
      "seed",
      "rng",
      "ships",
      "activeShipId",
      "log",
      "stats",
    ] as const) {
      expect(migrated[field]).toEqual(original[field]);
    }
  });

  /**
   * The v2 schema is derived from the current one, so the constraints the two
   * versions share cannot drift apart. These would pass against a hand-copied
   * schema that had fallen behind.
   */
  it("holds a v2 save to the same field constraints as a current one", () => {
    expect(parseState(v2Save({ phase: v2Voyage, company: "" }))).toBeNull();
    expect(parseState(v2Save({ phase: v2Voyage, reputation: 150 }))).toBeNull();
    expect(parseState(v2Save({ phase: v2Voyage, loan: -1 }))).toBeNull();
    expect(parseState(v2Save({ phase: v2Voyage, day: 0 }))).toBeNull();
  });

  it("rejects a v2 save missing a field the current version requires", () => {
    const { stats: _stats, ...withoutStats } = v2Save({ phase: v2Voyage });
    expect(parseState(withoutStats)).toBeNull();
  });

  it("rejects a v2 save carrying v3 fleet lists", () => {
    expect(parseState(v2Save({ phase: v2Voyage, voyages: [], arrivals: [] }))).toBeNull();
  });

  it("migrates a v3 save into an empty dock, carrying everything else", () => {
    const migrated = parseState(v3Save({ day: 12 }));
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(STATE_VERSION);
    expect(migrated!.refits).toEqual([]);
    expect(migrated!.day).toBe(12);
    expect(migrated!.ships).toEqual(fresh().ships);
    expect(migrated!.log).toEqual(fresh().log);
  });

  it("holds a v3 save to the same field constraints as a current one", () => {
    expect(parseState(v3Save({ reputation: 150 }))).toBeNull();
    expect(parseState(v3Save({ activeShipId: 7 }))).toBeNull();
  });

  it("rejects a v3 save carrying a v4 dock list", () => {
    expect(parseState(v3Save({ refits: [] }))).toBeNull();
  });

  it("round-trips a hull the yard still has", () => {
    const state: LandfallState = {
      ...fresh(),
      refits: [{ shipId: "s1", points: 24, days: 2, daysLeft: 1 }],
    };
    expect(parseState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it("rejects a finished refit left in the dock list", () => {
    const stale = {
      ...fresh(),
      refits: [{ shipId: "s1", points: 24, days: 2, daysLeft: 0 }],
    };
    expect(parseState(stale)).toBeNull();
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

  it("finds the yard job a hull is sitting out, and only hers", () => {
    const state: LandfallState = {
      ...fresh(),
      refits: [{ shipId: "s1", points: 24, days: 2, daysLeft: 2 }],
    };
    expect(refitOf(state, "s1")?.points).toBe(24);
    expect(refitOf(state, "s2")).toBeUndefined();
    expect(refitOf(fresh(), "s1")).toBeUndefined();
  });

  it("keeps a hull in dock on the port screen — she has a berth, not a passage", () => {
    const state: LandfallState = {
      ...fresh(),
      refits: [{ shipId: "s1", points: 24, days: 2, daysLeft: 2 }],
    };
    expect(bridgeView(state)).toBe("port");
  });

  it("shows the port screen when no ship is under command", () => {
    expect(bridgeView({ ...fresh(), activeShipId: null })).toBe("port");
  });

  describe("committedContractIds", () => {
    const lot = (id: string): Contract => ({
      id,
      cargo: "grain",
      tons: 100,
      from: "rotterdam",
      to: "london",
      ratePerTon: 10,
      payment: 1000,
      deadlineDay: null,
    });

    it("gathers lots from both ships under way and ships in the roads", () => {
      const state: LandfallState = {
        ...fresh(),
        voyages: [
          {
            shipId: "s1",
            contract: lot("at-sea"),
            speed: 12,
            legs: ["rotterdam", "london"],
            distanceNm: 165,
            coveredNm: 10,
            dayAtSea: 1,
            piracy: 0,
            lostTons: 0,
            pendingEvent: null,
          },
        ],
        arrivals: [
          {
            shipId: "s2",
            portId: "london",
            contract: lot("in-the-roads"),
            lostTons: 0,
            tugStrike: false,
          },
        ],
      };
      expect([...committedContractIds(state)].sort()).toEqual(["at-sea", "in-the-roads"]);
    });

    it("ignores hulls sailing in ballast", () => {
      const state: LandfallState = {
        ...fresh(),
        arrivals: [
          { shipId: "s1", portId: "london", contract: null, lostTons: 0, tugStrike: false },
        ],
      };
      expect(committedContractIds(state).size).toBe(0);
    });

    it("is empty for a company with nothing at sea", () => {
      expect(committedContractIds(fresh()).size).toBe(0);
    });
  });
});
