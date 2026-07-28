import { z } from "zod";
import { port } from "./world";

/**
 * Landfall's save document.
 *
 * The platform stores `state` as opaque jsonb — this file is the only thing
 * that knows what is inside it, and the only place a save migration would
 * live. A document that does not parse is reported, never silently reset.
 *
 * Version 1 was the deploy-check shell (a port name, a cash number and a log).
 * There is no company to carry over from it, so it does not migrate; the UI
 * reports it and offers to found a company, which is an explicit player
 * action, not a silent reset.
 *
 * Version 2 kept a single company-wide phase (port | voyage | docking), so
 * only one ship could be under way. Version 3 lifts voyages and arrivals onto
 * the fleet so several ships can carry freight at once.
 */

export const STATE_VERSION = 3;

// ── Pieces ───────────────────────────────────────────────────────────────────

export const shipSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** A `ShipModel` id from `world.ts`. */
    model: z.string(),
    /** Hull and engine health, 0–100. Wear accrues; repairs cost money. */
    condition: z.number().min(0).max(100),
    /** Bunker fuel on board, tons. */
    fuel: z.number().min(0),
    /** Where she lies — null while at sea. */
    port: z.string().nullable(),
    /** Chartered out: earns a day rate, unavailable to sail. */
    chartered: z.boolean(),
    boughtDay: z.number().int().nonnegative(),
  })
  .strict();

export type Ship = z.infer<typeof shipSchema>;

export const contractSchema = z
  .object({
    id: z.string(),
    cargo: z.string(),
    tons: z.number().positive(),
    from: z.string(),
    to: z.string(),
    ratePerTon: z.number().positive(),
    payment: z.number().positive(),
    /** Deliver by this game day or forfeit part of the payment. */
    deadlineDay: z.number().int().positive().nullable(),
  })
  .strict();

export type Contract = z.infer<typeof contractSchema>;

const pendingEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("storm") }).strict(),
  z.object({ kind: z.literal("engine"), cost: z.number().nonnegative() }).strict(),
  z.object({ kind: z.literal("rescue") }).strict(),
  z.object({ kind: z.literal("pirates"), tribute: z.number().nonnegative() }).strict(),
  z.object({ kind: z.literal("fuel"), cost: z.number().nonnegative() }).strict(),
]);

export type PendingEvent = z.infer<typeof pendingEventSchema>;

export const voyageSchema = z
  .object({
    shipId: z.string(),
    /** Null when sailing in ballast to reposition. */
    contract: contractSchema.nullable(),
    speed: z.number().positive(),
    /** Node ids origin → destination, exactly as `nav.ts` produced them. */
    legs: z.array(z.string()).min(2),
    distanceNm: z.number().positive(),
    coveredNm: z.number().nonnegative(),
    dayAtSea: z.number().int().nonnegative(),
    /** Highest piracy weight on the route, decided at departure. */
    piracy: z.number().nonnegative(),
    /** Cargo lost to weather or pirates, tons. */
    lostTons: z.number().nonnegative(),
    /** A noon report awaiting the captain's decision blocks the next day. */
    pendingEvent: pendingEventSchema.nullable(),
  })
  .strict();

export type Voyage = z.infer<typeof voyageSchema>;

export const arrivalSchema = z
  .object({
    shipId: z.string(),
    portId: z.string(),
    contract: contractSchema.nullable(),
    lostTons: z.number().nonnegative(),
    /** The tugs are on strike — the captain berths her by hand. */
    tugStrike: z.boolean(),
  })
  .strict();

export type Arrival = z.infer<typeof arrivalSchema>;

/** The end of the company — shared by every state version, past and present. */
const bankruptPhaseSchema = z
  .object({
    kind: z.literal("bankrupt"),
    day: z.number().int().positive(),
    finalNetWorth: z.number(),
  })
  .strict();

const phaseSchema = z.discriminatedUnion("kind", [
  /** The company is trading; each ship's berth / voyage / arrival is its own. */
  z.object({ kind: z.literal("operating") }).strict(),
  bankruptPhaseSchema,
]);

export type Phase = z.infer<typeof phaseSchema>;

const logEntrySchema = z
  .object({
    day: z.number().int().nonnegative(),
    text: z.string(),
    tone: z.enum(["info", "good", "bad"]),
  })
  .strict();

export type LogEntry = z.infer<typeof logEntrySchema>;

export const statsSchema = z
  .object({
    voyages: z.number().int().nonnegative(),
    deliveredTons: z.number().nonnegative(),
    milesSailed: z.number().nonnegative(),
    rescues: z.number().int().nonnegative(),
    manualDockings: z.number().int().nonnegative(),
  })
  .strict();

export type Stats = z.infer<typeof statsSchema>;

// ── The document ─────────────────────────────────────────────────────────────

export const MAX_LOG = 80;

export const landfallStateSchema = z
  .object({
    version: z.literal(STATE_VERSION),
    company: z.string().min(1),
    homePort: z.string(),
    /** Game day, 1 = founding day. */
    day: z.number().int().positive(),
    cash: z.number(),
    loan: z.number().nonnegative(),
    /** Standing with brokers and harbourmasters, 0–100. */
    reputation: z.number().min(0).max(100),
    /** Fixed at founding; every market in the world derives from it. */
    seed: z.number().int().nonnegative(),
    /** The evolving dice state — the seas roll the same after a reload. */
    rng: z.number().int().nonnegative(),
    ships: z.array(shipSchema),
    /** The ship the player is commanding. */
    activeShipId: z.string().nullable(),
    /** Concurrent passages — one entry per ship under way. */
    voyages: z.array(voyageSchema),
    /** Ships in the roads waiting to berth. */
    arrivals: z.array(arrivalSchema),
    phase: phaseSchema,
    log: z.array(logEntrySchema).max(MAX_LOG),
    stats: statsSchema,
  })
  .strict();

export type LandfallState = z.infer<typeof landfallStateSchema>;

/** Version 2 kept voyage/docking on the company phase (one ship at a time). */
const v2PhaseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("port") }).strict(),
  z.object({ kind: z.literal("voyage"), voyage: voyageSchema }).strict(),
  z.object({ kind: z.literal("docking"), arrival: arrivalSchema }).strict(),
  bankruptPhaseSchema,
]);

/**
 * v2 is v3 minus the fleet lists, plus the old phase. Deriving it keeps the
 * twelve fields the two versions share in exactly one place, so tightening a
 * constraint on the current schema cannot leave the migration accepting saves
 * the game would reject.
 */
const v2StateSchema = landfallStateSchema
  .omit({ version: true, voyages: true, arrivals: true, phase: true })
  .extend({ version: z.literal(2), phase: v2PhaseSchema })
  .strict();

// ── Constructors & helpers ───────────────────────────────────────────────────

export type Founding = {
  company: string;
  homePort: string;
  seed: number;
  cash: number;
  ship: Omit<Ship, "port" | "chartered" | "boughtDay">;
};

export function newGameState(founding: Founding): LandfallState {
  return {
    version: STATE_VERSION,
    company: founding.company,
    homePort: founding.homePort,
    day: 1,
    cash: founding.cash,
    loan: 0,
    reputation: 50,
    seed: founding.seed >>> 0,
    rng: (founding.seed ^ 0x5f3759df) >>> 0,
    ships: [
      {
        ...founding.ship,
        port: founding.homePort,
        chartered: false,
        boughtDay: 1,
      },
    ],
    activeShipId: founding.ship.id,
    voyages: [],
    arrivals: [],
    phase: { kind: "operating" },
    log: [
      {
        day: 1,
        text: `${founding.company} founded. ${founding.ship.name} lies ready in ${port(founding.homePort).name}.`,
        tone: "good",
      },
    ],
    stats: {
      voyages: 0,
      deliveredTons: 0,
      milesSailed: 0,
      rescues: 0,
      manualDockings: 0,
    },
  };
}

/** Append to the ship's log, oldest entries falling off the end. */
export function logged(
  state: LandfallState,
  text: string,
  tone: LogEntry["tone"] = "info",
): LandfallState {
  return {
    ...state,
    log: [...state.log.slice(-(MAX_LOG - 1)), { day: state.day, text, tone }],
  };
}

export function activeShip(state: LandfallState): Ship | null {
  return state.ships.find((ship) => ship.id === state.activeShipId) ?? null;
}

export function replaceShip(state: LandfallState, ship: Ship): LandfallState {
  return {
    ...state,
    ships: state.ships.map((existing) => (existing.id === ship.id ? ship : existing)),
  };
}

export function voyageOf(state: LandfallState, shipId: string): Voyage | undefined {
  return state.voyages.find((voyage) => voyage.shipId === shipId);
}

export function arrivalOf(state: LandfallState, shipId: string): Arrival | undefined {
  return state.arrivals.find((arrival) => arrival.shipId === shipId);
}

/**
 * Which of the four screens the bridge shows. Three of the names match their
 * components exactly; `"port"` is free again now that v3 has dropped the
 * company-wide `port` phase.
 */
export type BridgeView = "port" | "voyage" | "docking" | "bankrupt";

/** What the bridge should show for the ship under command. */
export function bridgeView(state: LandfallState): BridgeView {
  if (state.phase.kind === "bankrupt") return "bankrupt";
  const shipId = state.activeShipId;
  if (shipId === null) return "port";
  if (arrivalOf(state, shipId)) return "docking";
  if (voyageOf(state, shipId)) return "voyage";
  return "port";
}

/** Contract ids already spoken for by ships under way or in the roads. */
export function committedContractIds(state: LandfallState): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const voyage of state.voyages) {
    if (voyage.contract) ids.add(voyage.contract.id);
  }
  for (const arrival of state.arrivals) {
    if (arrival.contract) ids.add(arrival.contract.id);
  }
  return ids;
}

function migrateV2(raw: unknown): LandfallState | null {
  const parsed = v2StateSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { phase, ...carried } = parsed.data;

  // Only these four fields move between versions; everything else carries over.
  return {
    ...carried,
    version: STATE_VERSION,
    voyages: phase.kind === "voyage" ? [phase.voyage] : [],
    arrivals: phase.kind === "docking" ? [phase.arrival] : [],
    phase: phase.kind === "bankrupt" ? phase : { kind: "operating" },
  };
}

/** Unknown or future saves are reported, never silently reset. v2 migrates. */
export function parseState(raw: unknown): LandfallState | null {
  const current = landfallStateSchema.safeParse(raw);
  if (current.success) return current.data;
  return migrateV2(raw);
}
