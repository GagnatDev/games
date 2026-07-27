import { netWorth } from "../economy";
import type { LandfallState } from "../state";
import { moneyShort } from "./format";

/** The bridge instruments: who you are, what day it is, what you are worth. */
export function StatusBar({ state }: { state: LandfallState }) {
  const worth = netWorth(state);
  return (
    <div className="lf-status" role="group" aria-label="Company standing">
      <div className="lf-status__brand">
        <span className="lf-status__pennant" aria-hidden="true" />
        <span className="lf-status__company">{state.company}</span>
      </div>
      <dl className="lf-status__gauges">
        <div className="lf-gauge">
          <dt>Day</dt>
          <dd data-testid="lf-day">{state.day}</dd>
        </div>
        <div className="lf-gauge">
          <dt>Cash</dt>
          <dd data-testid="lf-cash" className={state.cash < 0 ? "lf-bad" : undefined}>
            {moneyShort(state.cash)}
          </dd>
        </div>
        <div className="lf-gauge">
          <dt>Loan</dt>
          <dd>{state.loan > 0 ? moneyShort(state.loan) : "—"}</dd>
        </div>
        <div className="lf-gauge">
          <dt>Net worth</dt>
          <dd className={worth < 0 ? "lf-bad" : "lf-good"}>{moneyShort(worth)}</dd>
        </div>
        <div className="lf-gauge">
          <dt>Standing</dt>
          <dd>
            <span
              className="lf-meter"
              role="meter"
              aria-valuenow={Math.round(state.reputation)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Reputation"
            >
              <span style={{ width: `${state.reputation}%` }} />
            </span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
