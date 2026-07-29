/**
 * Company time — the yard clock.
 *
 * A single day is `advanceDay` in `voyage.ts`: the ledger, every hull under way,
 * and then the dock. Yard work used to spend its days on the spot, turning the
 * calendar for the whole company the moment the captain ordered a refit. It no
 * longer does: a refit is a job the ship sits out. She is locked to the quay
 * until the plates are back on, and the days pass only as the captain spends
 * them — sending sisters to sea, taking freight for them, or waiting a day out
 * for a better board.
 *
 * Nothing here touches the sea or the market, so `voyage.ts` can call
 * `tickRefits` without either file importing the other.
 */
import {
  logged,
  refitOf,
  replaceShip,
  type LandfallState,
  type Refit,
} from "./state";
import { yardJob } from "./economy";

/**
 * Book a ship into the yard. The bill is paid now; the condition comes back on
 * the day she is let out. The calendar does not move — `tickRefits` counts the
 * days down as the company spends them.
 *
 * Refuses a hull the yard cannot have: one already in dock, one at sea, one on
 * charter (the charterer has her), and one with nothing left to mend.
 */
export function beginRefit(
  state: LandfallState,
  shipId: string,
  points: number,
): LandfallState {
  const job = yardJob(state, shipId, points);
  if (!job) return state;
  if (job.ship.chartered || refitOf(state, shipId)) return state;

  const refit: Refit = {
    shipId,
    points: job.points,
    days: job.days,
    daysLeft: job.days,
  };
  return logged(
    {
      ...state,
      cash: state.cash - job.cost,
      refits: [...state.refits, refit],
    },
    `${job.ship.name} into the yard — ${job.days} ${job.days === 1 ? "day" : "days"} in dock at $${job.cost.toLocaleString("en-US")}.`,
  );
}

/**
 * One day of yard work on every hull in dock. Those whose last day has run come
 * out mended; a refit whose ship has left the fleet is struck off rather than
 * counted down forever.
 */
export function tickRefits(state: LandfallState): LandfallState {
  if (state.refits.length === 0) return state;

  let next: LandfallState = { ...state, refits: [] };
  for (const refit of state.refits) {
    const ship = next.ships.find((s) => s.id === refit.shipId);
    if (!ship) continue;

    const daysLeft = refit.daysLeft - 1;
    if (daysLeft > 0) {
      next = { ...next, refits: [...next.refits, { ...refit, daysLeft }] };
      continue;
    }

    const mended = Math.min(100, Math.round((ship.condition + refit.points) * 10) / 10);
    next = logged(
      replaceShip(next, { ...ship, condition: mended }),
      `${ship.name} out of the yard after ${refit.days} ${refit.days === 1 ? "day" : "days"} — condition ${Math.round(mended)}%.`,
      "good",
    );
  }
  return next;
}
