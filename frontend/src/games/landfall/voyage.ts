/**
 * The sea: voyage planning, the day-by-day loop with its noon reports, and
 * what happens when the anchor finally drops.
 *
 * Everything here is pure. A day at sea is `advanceDay(state)`; a decision the
 * captain owes the ship is a `pendingEvent` that blocks the next day until
 * `resolveEvent` clears it. All rolls go through the dice state carried in the
 * save, so a reload mid-gale continues the same gale.
 *
 * Several ships may be under way at once. Company time (`passDay`) and every
 * clear passage tick together; a noon report on any hull holds the calendar
 * until the captain answers it.
 */
import { Dice } from "./rng";
import { cargo, port, shipModel } from "./world";
import {
  LATE_PENALTY_CAP,
  LATE_PENALTY_PER_DAY,
  canalToll,
  declareBankruptcyIfRuined,
  freightMarket,
  passDay,
  portFee,
  tugFee,
} from "./economy";
import { greatCircleNm, nodePosition, type Route } from "./nav";
import {
  arrivalOf,
  committedContractIds,
  logged,
  replaceShip,
  voyageOf,
  type Arrival,
  type Contract,
  type LandfallState,
  type PendingEvent,
  type Ship,
  type Voyage,
} from "./state";

// ── Planning ─────────────────────────────────────────────────────────────────

export function voyageDays(distanceNm: number, speed: number): number {
  return Math.ceil(distanceNm / (speed * 24));
}

/** Fuel burn rises steeply with speed — the classic Ports of Call dilemma. */
export function fuelPerDayAt(modelId: string, speed: number): number {
  const model = shipModel(modelId);
  return model.fuelPerDay * (speed / model.cruiseSpeed) ** 2.5;
}

export function fuelNeeded(modelId: string, distanceNm: number, speed: number): number {
  return Math.ceil(voyageDays(distanceNm, speed) * fuelPerDayAt(modelId, speed));
}

/** A worn engine will not make the trials speed any more. */
export function effectiveMaxSpeed(ship: Ship): number {
  const model = shipModel(ship.model);
  return Math.max(
    8,
    Math.round(model.maxSpeed * (0.65 + 0.35 * (ship.condition / 100)) * 2) / 2,
  );
}

export type DeparturePlan = {
  ship: Ship;
  contract: Contract | null;
  route: Route;
  speed: number;
};

export function canCarry(ship: Ship, contract: Contract): string | null {
  const model = shipModel(ship.model);
  const lot = cargo(contract.cargo);
  if (!model.carries.includes(lot.kind)) {
    return `${model.name} has no hold for ${lot.name.toLowerCase()}.`;
  }
  if (contract.tons > model.dwt) {
    return `${contract.tons.toLocaleString("en-US")}t will not fit in ${model.dwt.toLocaleString("en-US")} dwt.`;
  }
  return null;
}

/** Tolls due at the canal gates, paid on departure. */
export function routeTolls(route: Route, dwt: number): number {
  return route.canals.reduce((sum, canal) => sum + canalToll(canal, dwt), 0);
}

/** Where a passage is bound — her last leg. */
function destinationOf(voyage: Voyage): string {
  return port(voyage.legs[voyage.legs.length - 1]!).name;
}

/** Write a settled passage back over the one this ship was sailing. */
function withVoyage(state: LandfallState, shipId: string, voyage: Voyage): LandfallState {
  return {
    ...state,
    voyages: state.voyages.map((v) => (v.shipId === shipId ? voyage : v)),
  };
}

/** True while any noon report waits — the company calendar does not move. */
export function dayIsBlocked(state: LandfallState): boolean {
  return state.voyages.some((voyage) => voyage.pendingEvent !== null);
}

/** A wound-up company takes no further orders. */
export function companyIsFinished(state: LandfallState): boolean {
  return state.phase.kind === "bankrupt";
}

/**
 * Cast off. Charges tolls, moves the ship to sea and records her passage
 * alongside any others already under way. The caller has validated fuel and
 * capacity; this trusts the plan.
 */
export function depart(state: LandfallState, plan: DeparturePlan): LandfallState {
  if (companyIsFinished(state)) return state;
  if (plan.ship.port === null || plan.ship.chartered) return state;
  if (voyageOf(state, plan.ship.id) || arrivalOf(state, plan.ship.id)) return state;
  if (plan.contract && committedContractIds(state).has(plan.contract.id)) return state;

  const tolls = routeTolls(plan.route, shipModel(plan.ship.model).dwt);
  const voyage: Voyage = {
    shipId: plan.ship.id,
    contract: plan.contract,
    speed: plan.speed,
    legs: [...plan.route.legs],
    distanceNm: plan.route.distanceNm,
    coveredNm: 0,
    dayAtSea: 0,
    piracy: plan.route.piracy,
    lostTons: 0,
    pendingEvent: null,
  };

  let next = replaceShip(
    { ...state, cash: state.cash - tolls, voyages: [...state.voyages, voyage] },
    { ...plan.ship, port: null },
  );
  const destination = port(plan.route.legs[plan.route.legs.length - 1]!).name;
  next = logged(
    next,
    plan.contract
      ? `${plan.ship.name} cleared for ${destination} — ${plan.contract.tons.toLocaleString("en-US")}t of ${cargo(plan.contract.cargo).name.toLowerCase()} at ${plan.speed} knots.`
      : `${plan.ship.name} sailing in ballast for ${destination}.`,
  );
  if (tolls > 0) {
    next = logged(next, `Canal dues paid: $${tolls.toLocaleString("en-US")}.`);
  }
  return next;
}

// ── The day loop ─────────────────────────────────────────────────────────────

const STORM_CHANCE = 0.08;
const RESCUE_CHANCE = 0.022;
const CURRENT_CHANCE = 0.03;

type VoyageTick = {
  voyage: Voyage;
  /** The dice roll is already committed to `state.rng`. */
  state: LandfallState;
  /** She made her landfall this tick — the caller puts her in the roads. */
  arrived: boolean;
};

/**
 * One day at sea for a single hull. Caller has already ticked the company
 * ledger; this burns fuel, wears the hull, advances the track and may open a
 * noon report or make her landfall.
 *
 * Returns null when the passage has no hull left in the fleet — she cannot be
 * sailed, so the caller strikes her off rather than tick her forever.
 */
function tickVoyage(state: LandfallState, voyage: Voyage): VoyageTick | null {
  const ship = state.ships.find((s) => s.id === voyage.shipId);
  if (!ship) return null;

  const dice = new Dice(state.rng);
  const model = shipModel(ship.model);

  const burn = fuelPerDayAt(ship.model, voyage.speed);
  const fuelAfter = Math.max(0, Math.round((ship.fuel - burn) * 10) / 10);
  const wornShip: Ship = {
    ...ship,
    fuel: fuelAfter,
    condition: Math.max(0, Math.round((ship.condition - 0.15) * 100) / 100),
  };
  let next = replaceShip(state, wornShip);

  const covered = Math.min(voyage.distanceNm, voyage.coveredNm + voyage.speed * 24);
  let updated: Voyage = {
    ...voyage,
    dayAtSea: voyage.dayAtSea + 1,
    coveredNm: Math.round(covered),
  };

  // Bone dry mid-ocean: a tow is coming, and it will not be cheap.
  if (fuelAfter <= 0 && covered < voyage.distanceNm) {
    const cost = Math.round(40_000 + model.dwt * 1.5);
    updated = { ...updated, pendingEvent: { kind: "fuel", cost } };
    next = logged(next, `${ship.name} has burned her last ton of bunkers.`, "bad");
    return { voyage: updated, state: { ...next, rng: dice.state }, arrived: false };
  }

  if (covered >= voyage.distanceNm) {
    return { voyage: updated, state: { ...next, rng: dice.state }, arrived: true };
  }

  // One noon report a day, worst news first.
  let pending: PendingEvent | null = null;
  let logText: string | null = null;
  let tone: "info" | "good" | "bad" = "info";

  if (dice.chance(STORM_CHANCE)) {
    pending = { kind: "storm" };
    logText = `Heavy weather ahead of ${ship.name}. The barometer is falling fast.`;
    tone = "bad";
  } else if (voyage.piracy > 0 && dice.chance(voyage.piracy * 0.12)) {
    const payment = voyage.contract?.payment ?? 60_000;
    const tribute = Math.max(10_000, Math.round(payment * 0.03));
    pending = { kind: "pirates", tribute };
    logText = `A fast skiff is closing on ${ship.name} and answering no hails.`;
    tone = "bad";
  } else if (dice.chance((0.4 + (100 - wornShip.condition) * 0.2) / 100)) {
    const cost = Math.round(4000 + model.dwt * 0.4 * dice.range(0.6, 1.4));
    pending = { kind: "engine", cost };
    logText = `Engine room reports a breakdown aboard ${ship.name}.`;
    tone = "bad";
  } else if (dice.chance(RESCUE_CHANCE)) {
    pending = { kind: "rescue" };
    logText = `Distress flare sighted — a liferaft on the swell off the port bow.`;
    tone = "info";
  } else if (dice.chance(CURRENT_CHANCE)) {
    updated = {
      ...updated,
      coveredNm: Math.min(voyage.distanceNm, updated.coveredNm + Math.round(voyage.speed * 7)),
    };
    logText = `A following current — ${ship.name} is running ahead of her reckoning.`;
    tone = "good";
  }

  updated = { ...updated, pendingEvent: pending };
  if (logText) next = logged(next, logText, tone);
  return { voyage: updated, state: { ...next, rng: dice.state }, arrived: false };
}

/**
 * She has made her landfall: off the passage list, into the roads. Reads the
 * dice from `state.rng` so there is only ever one of them in play.
 */
function putInRoads(state: LandfallState, voyage: Voyage): LandfallState {
  const dice = new Dice(state.rng);
  const portId = voyage.legs[voyage.legs.length - 1]!;
  const arrival: Arrival = {
    shipId: voyage.shipId,
    portId,
    contract: voyage.contract,
    lostTons: voyage.lostTons,
    tugStrike: dice.chance(0.1),
  };

  const next: LandfallState = {
    ...state,
    rng: dice.state,
    voyages: state.voyages.filter((v) => v.shipId !== voyage.shipId),
    arrivals: [...state.arrivals.filter((a) => a.shipId !== voyage.shipId), arrival],
    stats: {
      ...state.stats,
      milesSailed: Math.round(state.stats.milesSailed + voyage.distanceNm),
    },
  };
  return logged(
    next,
    `${destinationOf(voyage)} roads. ${arrival.tugStrike ? "The tugs are on strike — she goes in by hand." : "Pilot aboard, berth assigned."}`,
  );
}

/**
 * One day for the whole company: ledger, then every clear passage. No-op while
 * a noon report waits for a decision. Ships that make port join `arrivals`.
 */
export function advanceDay(state: LandfallState): LandfallState {
  if (companyIsFinished(state)) return state;
  if (dayIsBlocked(state)) return state;

  // Start the day with an empty passage list and rebuild it as each hull ticks;
  // the ones that make port land in `arrivals` instead.
  let next: LandfallState = { ...passDay(state), voyages: [] };

  for (const voyage of state.voyages) {
    const tick = tickVoyage(next, voyage);
    if (!tick) {
      next = logged(next, `${destinationOf(voyage)} passage struck off — no ship.`, "bad");
      continue;
    }
    next = tick.arrived
      ? putInRoads(tick.state, tick.voyage)
      : { ...tick.state, voyages: [...tick.state.voyages, tick.voyage] };
  }

  return next;
}

export type EventChoice =
  | "press-on"
  | "heave-to"
  | "pay-tribute"
  | "run"
  | "divert"
  | "sail-past"
  | "acknowledge";

/**
 * Settle the pending noon report on a ship and free the company calendar.
 * `shipId` is explicit: with a fleet under way, the ship that needs the captain
 * is often not the one under command.
 */
export function resolveEvent(
  state: LandfallState,
  choice: EventChoice,
  shipId: string,
): LandfallState {
  const voyage = voyageOf(state, shipId);
  const event = voyage?.pendingEvent;
  const ship = state.ships.find((s) => s.id === shipId);
  if (!voyage || !event || !ship) return state;

  const dice = new Dice(state.rng);
  let next = state;
  let updated: Voyage = { ...voyage, pendingEvent: null };

  switch (event.kind) {
    case "storm": {
      if (choice === "heave-to") {
        updated = {
          ...updated,
          coveredNm: Math.max(0, updated.coveredNm - Math.round(voyage.speed * 18)),
        };
        next = logged(next, `${ship.name} hove to and rode the storm out. A day lost, nothing carried away.`);
      } else {
        if (dice.chance(0.45)) {
          const damage = dice.int(4, 12);
          const hit: Ship = {
            ...ship,
            condition: Math.max(0, ship.condition - damage),
          };
          let text = `${ship.name} pressed on through the gale — hull down ${damage}%.`;
          if (voyage.contract && dice.chance(0.3)) {
            const swept = Math.round(voyage.contract.tons * dice.range(0.02, 0.06));
            updated = { ...updated, lostTons: updated.lostTons + swept };
            text += ` ${swept.toLocaleString("en-US")}t of cargo lost overboard.`;
          }
          next = logged(replaceShip(next, hit), text, "bad");
        } else {
          next = logged(next, `${ship.name} pressed on and took the seas on the bow. No damage.`, "good");
        }
      }
      break;
    }
    case "pirates": {
      if (choice === "pay-tribute") {
        next = logged(
          { ...next, cash: next.cash - event.tribute },
          `Paid the boarding party $${event.tribute.toLocaleString("en-US")} to be gone.`,
          "bad",
        );
      } else {
        const escapeOdds = 0.5 + (voyage.speed - 10) * 0.04;
        if (dice.chance(Math.max(0.25, Math.min(0.9, escapeOdds)))) {
          next = logged(next, `${ship.name} ran for it and shook the skiff off by dusk.`, "good");
        } else {
          const damage = dice.int(3, 8);
          const stolen = voyage.contract
            ? Math.round(voyage.contract.tons * dice.range(0.05, 0.1))
            : 0;
          updated = { ...updated, lostTons: updated.lostTons + stolen };
          next = replaceShip(next, {
            ...ship,
            condition: Math.max(0, ship.condition - damage),
          });
          next = logged(
            next,
            stolen > 0
              ? `They boarded her. ${stolen.toLocaleString("en-US")}t of cargo gone and the bridge shot up.`
              : `They boarded her and stripped what they could carry.`,
            "bad",
          );
        }
      }
      break;
    }
    case "engine": {
      updated = {
        ...updated,
        coveredNm: Math.max(0, updated.coveredNm - Math.round(voyage.speed * 12)),
      };
      next = replaceShip(next, {
        ...ship,
        condition: Math.max(0, ship.condition - 2),
      });
      next = logged(
        { ...next, cash: next.cash - event.cost },
        `Drifted half a day while the engineers made repairs: $${event.cost.toLocaleString("en-US")}.`,
        "bad",
      );
      break;
    }
    case "rescue": {
      if (choice === "divert") {
        const reward = dice.int(15, 40) * 1000;
        updated = {
          ...updated,
          coveredNm: Math.max(0, updated.coveredNm - Math.round(voyage.speed * 10)),
        };
        next = {
          ...next,
          cash: next.cash + reward,
          reputation: Math.min(100, next.reputation + 4),
          stats: { ...next.stats, rescues: next.stats.rescues + 1 },
        };
        next = logged(
          next,
          `Seven souls lifted from the raft. The owners' club wired $${reward.toLocaleString("en-US")} in thanks.`,
          "good",
        );
      } else {
        next = {
          ...next,
          reputation: Math.max(0, next.reputation - 3),
        };
        next = logged(next, `${ship.name} held her course. The flare burned out astern.`, "bad");
      }
      break;
    }
    case "fuel": {
      // The tow takes her the rest of the way; the bill is brutal.
      next = logged(
        { ...next, cash: next.cash - event.cost, reputation: Math.max(0, next.reputation - 2) },
        `Under tow. Salvage invoice: $${event.cost.toLocaleString("en-US")}.`,
        "bad",
      );
      updated = { ...updated, coveredNm: voyage.distanceNm };
      // Straight into the roads — no point writing her back onto the passage
      // list that `putInRoads` is about to take her off.
      return putInRoads({ ...next, rng: dice.state }, updated);
    }
  }

  return withVoyage({ ...next, rng: dice.state }, shipId, updated);
}

// ── Berthing & delivery ──────────────────────────────────────────────────────

export type DockingOutcome = {
  method: "tug" | "manual";
  /** Contact with the quay — damage in condition points, 0 for a clean berth. */
  damage: number;
  /** The clock ran out and a tug had to finish the job at a premium. */
  emergencyTow: boolean;
};

/**
 * The ship is fast alongside — settle every account the arrival opened:
 * tug and port fees, docking damage, then the freight payment with its
 * deadline maths, reputation and stats.
 */
export function completeArrival(
  state: LandfallState,
  outcome: DockingOutcome,
  shipId: string,
): LandfallState {
  const arrival = arrivalOf(state, shipId);
  const ship = state.ships.find((s) => s.id === shipId);
  if (!arrival || !ship || companyIsFinished(state)) return state;

  const here = port(arrival.portId);
  const model = shipModel(ship.model);
  let next: LandfallState = {
    ...state,
    arrivals: state.arrivals.filter((a) => a.shipId !== shipId),
  };
  let cash = state.cash;
  let reputation = state.reputation;

  if (outcome.method === "tug") cash -= tugFee(model.dwt);
  if (outcome.emergencyTow) cash -= Math.round(tugFee(model.dwt) * 1.5);
  cash -= portFee(here, model.dwt);

  let berthed: Ship = { ...ship, port: arrival.portId };
  if (outcome.damage > 0) {
    const fine = Math.round(6000 + outcome.damage * 900);
    cash -= fine;
    berthed = { ...berthed, condition: Math.max(0, berthed.condition - outcome.damage) };
    next = logged(
      next,
      `Hard alongside — hull down ${outcome.damage}% and a $${fine.toLocaleString("en-US")} harbour fine.`,
      "bad",
    );
    reputation = Math.max(0, reputation - 2);
  } else if (outcome.method === "manual" && !outcome.emergencyTow) {
    reputation = Math.min(100, reputation + 1);
    next = {
      ...next,
      stats: { ...next.stats, manualDockings: next.stats.manualDockings + 1 },
    };
  }

  let stats = next.stats;
  if (arrival.contract) {
    const contract = arrival.contract;
    const deliveredTons = Math.max(0, contract.tons - arrival.lostTons);
    let payment = Math.round(contract.payment * (deliveredTons / contract.tons));

    let text = `${deliveredTons.toLocaleString("en-US")}t of ${cargo(contract.cargo).name.toLowerCase()} delivered in ${here.name}`;
    if (contract.deadlineDay !== null && next.day > contract.deadlineDay) {
      const daysLate = next.day - contract.deadlineDay;
      const penalty = Math.min(LATE_PENALTY_CAP, daysLate * LATE_PENALTY_PER_DAY);
      payment = Math.round(payment * (1 - penalty));
      reputation = Math.max(0, reputation - Math.min(6, 2 + daysLate));
      text += `, ${daysLate} ${daysLate === 1 ? "day" : "days"} late`;
    } else {
      reputation = Math.min(100, reputation + 1);
    }
    text += ` — $${payment.toLocaleString("en-US")} banked.`;

    cash += payment;
    stats = {
      ...stats,
      voyages: stats.voyages + 1,
      deliveredTons: Math.round(stats.deliveredTons + deliveredTons),
    };
    next = logged(next, text, "good");
  } else {
    next = logged(next, `${ship.name} made ${here.name} in ballast.`);
    stats = { ...stats, voyages: stats.voyages + 1 };
  }

  next = replaceShip(
    { ...next, cash: Math.round(cash), reputation, stats },
    berthed,
  );

  // Ruin is checked at the quay, where the bills land.
  return declareBankruptcyIfRuined(next);
}

/** Everything the departure screen needs to price a market row. */
export function estimateVoyage(
  ship: Ship,
  contract: Contract | null,
  route: Route,
  speed: number,
): {
  days: number;
  fuelTons: number;
  fuelShort: number;
  tolls: number;
  runningCosts: number;
  expectedProfit: number;
} {
  const model = shipModel(ship.model);
  const days = voyageDays(route.distanceNm, speed);
  const fuelTons = fuelNeeded(ship.model, route.distanceNm, speed);
  const tolls = routeTolls(route, model.dwt);
  const fuelShort = Math.max(0, fuelTons - ship.fuel);
  // Fuel is costed at the departure port's bunker price for the estimate.
  const from = ship.port ? port(ship.port) : null;
  const fuelCost = Math.round(fuelTons * (from?.fuelPrice ?? 440));
  const runningCosts = fuelCost + days * model.crewPerDay + tolls;
  const expectedProfit = (contract?.payment ?? 0) - runningCosts;
  return { days, fuelTons, fuelShort, tolls, runningCosts, expectedProfit };
}

/** The market of the port a ship is lying in, or an empty board at sea. */
export function marketHere(state: LandfallState, ship: Ship): Contract[] {
  return ship.port ? freightMarket(state, ship.port) : [];
}

export function routeFromLegs(legs: readonly string[]): Route {
  let distance = 0;
  for (let i = 0; i < legs.length - 1; i += 1) {
    distance += greatCircleNm(nodePosition(legs[i]!), nodePosition(legs[i + 1]!));
  }
  return { legs, distanceNm: Math.round(distance), canals: [], piracy: 0 };
}
