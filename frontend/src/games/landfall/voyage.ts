/**
 * The sea: voyage planning, the day-by-day loop with its noon reports, and
 * what happens when the anchor finally drops.
 *
 * Everything here is pure. A day at sea is `advanceDay(state)`; a decision the
 * captain owes the ship is a `pendingEvent` that blocks the next day until
 * `resolveEvent` clears it. All rolls go through the dice state carried in the
 * save, so a reload mid-gale continues the same gale.
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
  logged,
  replaceShip,
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

/**
 * Cast off. Charges tolls, moves the ship to sea and opens the voyage phase.
 * The caller has validated fuel and capacity; this trusts the plan.
 */
export function depart(state: LandfallState, plan: DeparturePlan): LandfallState {
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
    { ...state, cash: state.cash - tolls, phase: { kind: "voyage", voyage } },
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

/**
 * One day at sea. No-op while a noon report waits for a decision. Consumes
 * fuel, wears the hull, advances the track, then rolls the day's trouble.
 * Arrival flips the phase to docking.
 */
export function advanceDay(state: LandfallState): LandfallState {
  if (state.phase.kind !== "voyage" || state.phase.voyage.pendingEvent) return state;
  const voyage = state.phase.voyage;
  const ship = state.ships.find((s) => s.id === voyage.shipId);
  if (!ship) return state;

  const dice = new Dice(state.rng);
  const model = shipModel(ship.model);

  // The whole company's ledger ticks over first.
  let next = passDay(state);

  const burn = fuelPerDayAt(ship.model, voyage.speed);
  const fuelAfter = Math.max(0, Math.round((ship.fuel - burn) * 10) / 10);
  const wornShip: Ship = {
    ...ship,
    fuel: fuelAfter,
    condition: Math.max(0, Math.round((ship.condition - 0.15) * 100) / 100),
  };
  next = replaceShip(next, wornShip);

  const covered = Math.min(
    voyage.distanceNm,
    voyage.coveredNm + voyage.speed * 24,
  );
  let updated: Voyage = {
    ...voyage,
    dayAtSea: voyage.dayAtSea + 1,
    coveredNm: Math.round(covered),
  };

  // Bone dry mid-ocean: a tow is coming, and it will not be cheap.
  if (fuelAfter <= 0 && covered < voyage.distanceNm) {
    const cost = Math.round(40_000 + model.dwt * 1.5);
    updated = { ...updated, pendingEvent: { kind: "fuel", cost } };
    next = { ...next, rng: dice.state, phase: { kind: "voyage", voyage: updated } };
    return logged(next, `${ship.name} has burned her last ton of bunkers.`, "bad");
  }

  if (covered >= voyage.distanceNm) {
    return arrive({ ...next, rng: dice.state, phase: { kind: "voyage", voyage: updated } });
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
  next = { ...next, rng: dice.state, phase: { kind: "voyage", voyage: updated } };
  return logText ? logged(next, logText, tone) : next;
}

export type EventChoice =
  | "press-on"
  | "heave-to"
  | "pay-tribute"
  | "run"
  | "divert"
  | "sail-past"
  | "acknowledge";

/** Settle the pending noon report and free the next day. */
export function resolveEvent(state: LandfallState, choice: EventChoice): LandfallState {
  if (state.phase.kind !== "voyage") return state;
  const voyage = state.phase.voyage;
  const event = voyage.pendingEvent;
  const ship = state.ships.find((s) => s.id === voyage.shipId);
  if (!event || !ship) return state;

  const dice = new Dice(state.rng);
  const model = shipModel(ship.model);
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
      next = { ...next, rng: dice.state, phase: { kind: "voyage", voyage: updated } };
      return arrive(next);
    }
  }

  return { ...next, rng: dice.state, phase: { kind: "voyage", voyage: updated } };
}

// ── Arrival ──────────────────────────────────────────────────────────────────

function arrive(state: LandfallState): LandfallState {
  if (state.phase.kind !== "voyage") return state;
  const voyage = state.phase.voyage;
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
    stats: {
      ...state.stats,
      milesSailed: Math.round(state.stats.milesSailed + voyage.distanceNm),
    },
    phase: { kind: "docking", arrival },
  };
  return logged(
    next,
    `${port(portId).name} roads. ${arrival.tugStrike ? "The tugs are on strike — she goes in by hand." : "Pilot aboard, berth assigned."}`,
  );
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
): LandfallState {
  if (state.phase.kind !== "docking") return state;
  const arrival = state.phase.arrival;
  const ship = state.ships.find((s) => s.id === arrival.shipId);
  if (!ship) return state;

  const here = port(arrival.portId);
  const model = shipModel(ship.model);
  let next = state;
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
    { ...next, cash: Math.round(cash), reputation, stats, phase: { kind: "port" } },
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
