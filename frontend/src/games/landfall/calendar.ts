/**
 * Company time — the operations that spend days rather than only money.
 *
 * A single day is `advanceDay` in `voyage.ts`: the ledger, then every hull
 * under way. Anything that consumes *several* days has to reach both the money
 * side and the sea side, so it belongs above them both rather than inside
 * either. Keeping that composition here is what stops `economy.ts` and
 * `voyage.ts` importing each other.
 */
import { logged, replaceShip, type LandfallState } from "./state";
import { yardJob } from "./economy";
import { advanceDay, dayIsBlocked } from "./voyage";

/**
 * Yard work: money per point, and a day in dock per 12 points started. Yard
 * time is company time, so every ship under way sails on while she is in dock.
 *
 * Refuses while a noon report is open — the bill is in days, and the calendar
 * cannot turn until the captain has answered. `PortScreen` disables the button
 * and says so rather than letting the click do nothing.
 */
export function repair(state: LandfallState, shipId: string, points: number): LandfallState {
  const job = yardJob(state, shipId, points);
  if (!job) return state;
  if (dayIsBlocked(state)) return state;

  const mended = Math.round((job.ship.condition + job.points) * 10) / 10;
  let next = replaceShip(
    { ...state, cash: state.cash - job.cost },
    { ...job.ship, condition: mended },
  );
  for (let i = 0; i < job.days; i += 1) next = advanceDay(next);
  return logged(
    next,
    `${job.ship.name} spent ${job.days} ${job.days === 1 ? "day" : "days"} in the yard — condition ${Math.round(mended)}%.`,
  );
}
