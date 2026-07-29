/**
 * The money side of Landfall: freight markets, the used-ship trade, fuel,
 * repairs, loans, charters and the daily ledger.
 *
 * Markets are derived, not stored. Each port's offers on a given day come from
 * a seed hashed out of (game seed, port, day), so every device shows the same
 * board without the save carrying it — and waiting a day really does roll new
 * cargo.
 */
import { Dice, hashSeed } from "./rng";
import {
  CARGOES,
  PORTS,
  SHIP_MODELS,
  SHIP_NAMES,
  cargo,
  port,
  shipModel,
  type Port,
  type ShipModel,
} from "./world";
import { shortestRoute } from "./nav";
import {
  logged,
  refitOf,
  replaceShip,
  type Contract,
  type LandfallState,
  type Ship,
} from "./state";

// ── Tuning ───────────────────────────────────────────────────────────────────

export const LOAN_DAILY_INTEREST = 0.0006; // ≈ 22% a year — tramp rates.
export const IDLE_DUES_PER_SIZE = 140; // harbour dues per day for a laid-up ship
export const DEADLINE_PREMIUM = 1.28;
export const LATE_PENALTY_PER_DAY = 0.04;
export const LATE_PENALTY_CAP = 0.4;

// ── Valuation ────────────────────────────────────────────────────────────────

export function shipValue(model: ShipModel, condition: number): number {
  return Math.round(model.priceNew * (0.3 + 0.6 * (condition / 100)));
}

export function fleetValue(state: LandfallState): number {
  return state.ships.reduce(
    (sum, ship) => sum + shipValue(shipModel(ship.model), ship.condition),
    0,
  );
}

export function netWorth(state: LandfallState): number {
  return Math.round(state.cash - state.loan + fleetValue(state));
}

export function maxLoan(state: LandfallState): number {
  return Math.round(fleetValue(state) * 0.5 + 400_000);
}

// ── Fees ─────────────────────────────────────────────────────────────────────

export function portFee(at: Port, dwt: number): number {
  return Math.round(at.size * 1800 + dwt * 0.9);
}

export function tugFee(dwt: number): number {
  return Math.round(1500 + dwt * 0.35);
}

export function repairCostPerPoint(model: ShipModel): number {
  return Math.round(260 * (model.dwt / 1000) ** 0.7);
}

export function canalToll(canal: "suez" | "panama", dwt: number): number {
  return canal === "suez"
    ? Math.round(12_000 + dwt * 5.5)
    : Math.round(9_000 + dwt * 4.5);
}

/** What an idle ship earns per day when chartered out (charterer crews her). */
export function charterRate(ship: Ship): number {
  const model = shipModel(ship.model);
  return Math.round(150 + model.dwt * 0.11 * (ship.condition / 100));
}

// ── Freight market ───────────────────────────────────────────────────────────

/** Lot sizes brokers deal in, weighted towards what the port can move. */
const LOT_BANDS: readonly (readonly [number, number])[] = [
  [1200, 3000],
  [4000, 8200],
  [9000, 19_000],
  [22_000, 42_000],
];

/**
 * The cargo on offer in `portId` on the current day. Pure — same inputs, same
 * board, so it is never stored in the save.
 */
export function freightMarket(state: LandfallState, portId: string): Contract[] {
  const here = port(portId);
  const dice = new Dice(hashSeed(state.seed, "market", portId, state.day));
  const count = 3 + here.size + dice.int(0, 2);

  const exportIds = Object.keys(here.exports);
  const weights = exportIds.map((id) => here.exports[id] ?? 0);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const contracts: Contract[] = [];
  for (let i = 0; i < count; i += 1) {
    // Weighted export pick, with an occasional out-of-character lot.
    let cargoId = exportIds[0] ?? "grain";
    if (dice.chance(0.12)) {
      cargoId = dice.pick(CARGOES).id;
    } else {
      let roll = dice.next() * totalWeight;
      for (let k = 0; k < exportIds.length; k += 1) {
        roll -= weights[k] ?? 0;
        if (roll <= 0) {
          cargoId = exportIds[k]!;
          break;
        }
      }
    }
    const lot = cargo(cargoId);

    const destination = dice.pick(PORTS.filter((p) => p.id !== portId));
    const route = shortestRoute(portId, destination.id);
    if (!route) continue;

    // Small ports rarely stage the monster lots.
    const bandCeiling = here.size === 3 ? 4 : here.size === 2 ? 3 : 2;
    const band = LOT_BANDS[dice.int(0, bandCeiling - 1)]!;
    const tons = Math.round(dice.range(band[0], band[1]) / 50) * 50;

    const perishable = lot.perishable === true;
    const hasDeadline = perishable || dice.chance(0.35);
    // Doable at a mid-fleet 12 knots, with a little slack rolled in.
    const deadlineDay = hasDeadline
      ? state.day + Math.ceil(route.distanceNm / (12 * 24)) + dice.int(2, 6)
      : null;

    const swing = dice.range(0.82, 1.32);
    const lotDiscount = 1 - Math.min(0.18, tons / 300_000);
    const reputationLift = 1 + (state.reputation - 50) / 600;
    const premium = hasDeadline ? DEADLINE_PREMIUM : 1;
    const ratePerTon =
      Math.round(
        Math.max(
          2.5,
          lot.rate * (route.distanceNm / 1000) * swing * lotDiscount * reputationLift * premium,
        ) * 100,
      ) / 100;

    contracts.push({
      id: `${portId}-${state.day}-${i}`,
      cargo: cargoId,
      tons,
      from: portId,
      to: destination.id,
      ratePerTon,
      payment: Math.round(ratePerTon * tons),
      deadlineDay,
    });
  }

  return contracts;
}

// ── The used-ship market ─────────────────────────────────────────────────────

export type ShipOffer = {
  readonly id: string;
  readonly name: string;
  readonly model: ShipModel;
  readonly condition: number;
  readonly price: number;
};

/**
 * Hulls for sale in `portId` this week. Only ports of size 2+ run a yard, and
 * the board rolls weekly rather than daily — ships move slower than grain.
 */
export function shipyard(state: LandfallState, portId: string): ShipOffer[] {
  const here = port(portId);
  if (here.size < 2) return [];

  const week = Math.floor(state.day / 7);
  const dice = new Dice(hashSeed(state.seed, "yard", portId, week));
  const count = here.size + dice.int(0, 2);

  const offers: ShipOffer[] = [];
  for (let i = 0; i < count; i += 1) {
    const model = dice.pick(SHIP_MODELS);
    const condition = dice.int(45, 88);
    const price = Math.round(shipValue(model, condition) * dice.range(0.92, 1.15));
    offers.push({
      id: `${portId}-w${week}-${i}`,
      name: dice.pick(SHIP_NAMES),
      model,
      condition,
      price,
    });
  }
  return offers;
}

/** Starter hulls offered at founding: affordable, honest, a little tired. */
export function foundingOffers(seed: number, capital: number): ShipOffer[] {
  const dice = new Dice(hashSeed(seed, "founding"));
  // The most capable hulls the capital can carry, smallest last.
  const picks = SHIP_MODELS.filter((model) => shipValue(model, 60) <= capital * 0.85)
    .sort((a, b) => b.priceNew - a.priceNew)
    .slice(0, 3);
  return picks.map((model, i) => {
    const condition = dice.int(55, 78);
    return {
      id: `founding-${i}`,
      name: dice.pick(SHIP_NAMES),
      model,
      condition,
      price: Math.round(shipValue(model, condition) * dice.range(0.9, 1.02)),
    };
  });
}

// ── Port actions ─────────────────────────────────────────────────────────────

export function refuel(state: LandfallState, shipId: string, tons: number): LandfallState {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.port === null) return state;
  const model = shipModel(ship.model);
  const bought = Math.min(tons, model.fuelTank - ship.fuel);
  if (bought <= 0) return state;
  const cost = Math.round(bought * port(ship.port).fuelPrice);
  return replaceShip(
    { ...state, cash: state.cash - cost },
    { ...ship, fuel: Math.round((ship.fuel + bought) * 10) / 10 },
  );
}

export type YardJob = {
  ship: Ship;
  /** Condition points the yard will actually put back. */
  points: number;
  cost: number;
  /** A day in dock per 12 points started. */
  days: number;
};

/**
 * What the yard would charge for this ship and how long she would be out of
 * service — null if there is no yard work to do here. Quoting only: booking her
 * in and counting the days down is `calendar.ts`.
 */
export function yardJob(state: LandfallState, shipId: string, points: number): YardJob | null {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.port === null) return null;
  const fixed = Math.min(points, 100 - ship.condition);
  if (fixed <= 0) return null;
  return {
    ship,
    points: fixed,
    cost: fixed * repairCostPerPoint(shipModel(ship.model)),
    days: Math.ceil(fixed / 12),
  };
}

export function buyShip(
  state: LandfallState,
  offer: ShipOffer,
  atPort: string,
  chosenName: string,
): LandfallState {
  const ship: Ship = {
    id: `ship-${state.seed.toString(36)}-${state.day}-${state.ships.length}`,
    name: chosenName.trim() || offer.name,
    model: offer.model.id,
    condition: offer.condition,
    fuel: Math.round(offer.model.fuelTank * 0.25),
    port: atPort,
    chartered: false,
    boughtDay: state.day,
  };
  const next: LandfallState = {
    ...state,
    cash: state.cash - offer.price,
    ships: [...state.ships, ship],
    activeShipId: state.activeShipId ?? ship.id,
  };
  return logged(next, `Bought ${ship.name} (${offer.model.name}) for $${offer.price.toLocaleString("en-US")}.`, "good");
}

/** Selling fetches value less the broker's cut. The last ship can go too — a
 * shipowner without ships is one loan away from the end. */
export function sellShip(state: LandfallState, shipId: string): LandfallState {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.port === null || refitOf(state, shipId)) return state;
  const proceeds = Math.round(shipValue(shipModel(ship.model), ship.condition) * 0.92);
  const remaining = state.ships.filter((s) => s.id !== shipId);
  const next: LandfallState = {
    ...state,
    cash: state.cash + proceeds,
    ships: remaining,
    activeShipId:
      state.activeShipId === shipId ? (remaining[0]?.id ?? null) : state.activeShipId,
  };
  return logged(next, `Sold ${ship.name} for $${proceeds.toLocaleString("en-US")}.`);
}

export function takeLoan(state: LandfallState, amount: number): LandfallState {
  const granted = Math.max(0, Math.min(amount, maxLoan(state) - state.loan));
  if (granted <= 0) return state;
  return logged(
    { ...state, cash: state.cash + granted, loan: state.loan + granted },
    `Drew $${granted.toLocaleString("en-US")} against the fleet.`,
  );
}

export function repayLoan(state: LandfallState, amount: number): LandfallState {
  const repaid = Math.max(0, Math.min(amount, state.loan, state.cash));
  if (repaid <= 0) return state;
  return { ...state, cash: state.cash - repaid, loan: state.loan - repaid };
}

export function setChartered(
  state: LandfallState,
  shipId: string,
  chartered: boolean,
): LandfallState {
  const ship = state.ships.find((s) => s.id === shipId);
  if (!ship || ship.port === null) return state;
  // A hull in dock cannot be handed to a charterer, and the yard will not take
  // one that already is: `beginRefit` refuses her, so this pair cannot cross.
  if (chartered && refitOf(state, shipId)) return state;
  const next = replaceShip(state, { ...ship, chartered });
  return logged(
    next,
    chartered
      ? `${ship.name} fixed on time charter at $${charterRate(ship).toLocaleString("en-US")} a day.`
      : `${ship.name} released from charter.`,
  );
}

// ── The daily ledger ─────────────────────────────────────────────────────────

/**
 * One day passes for the whole company: wages, dues, charter hire and loan
 * interest. Sailing costs (fuel, wear) live in `voyage.ts`; this is everything
 * that happens whether or not anyone casts off.
 */
export function passDay(state: LandfallState): LandfallState {
  let cash = state.cash;
  let ships = state.ships;

  for (const ship of state.ships) {
    const model = shipModel(ship.model);
    if (ship.chartered) {
      cash += charterRate(ship);
      ships = ships.map((s) =>
        s.id === ship.id
          ? { ...s, condition: Math.max(0, Math.round((s.condition - 0.08) * 100) / 100) }
          : s,
      );
      continue;
    }
    cash -= model.crewPerDay;
    if (ship.port !== null) cash -= port(ship.port).size * IDLE_DUES_PER_SIZE;
  }

  cash -= Math.round(state.loan * LOAN_DAILY_INTEREST);

  return { ...state, day: state.day + 1, cash: Math.round(cash), ships };
}

/** The company is finished when everything it owns cannot cover the debt. */
export function isBankrupt(state: LandfallState): boolean {
  return netWorth(state) < 0;
}

export function declareBankruptcyIfRuined(state: LandfallState): LandfallState {
  if (!isBankrupt(state) || state.phase.kind === "bankrupt") return state;
  const final = netWorth(state);
  return logged(
    {
      ...state,
      phase: { kind: "bankrupt", day: state.day, finalNetWorth: final },
    },
    `The bank has called in the fleet. ${state.company} is wound up.`,
    "bad",
  );
}
