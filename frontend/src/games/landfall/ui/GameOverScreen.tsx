import type { LandfallState } from "../state";
import { money, nm, tons } from "./format";
import { RecentReports } from "./VoyageScreen";

/** The wind-up notice, and the offer to go again. */
export function GameOverScreen({
  state,
  onFoundAgain,
}: {
  state: LandfallState;
  onFoundAgain: () => void;
}) {
  if (state.phase.kind !== "bankrupt") return null;
  const { day, finalNetWorth } = state.phase;

  return (
    <div className="lf-gameover stack">
      <section className="card lf-panel stack">
        <h2>{state.company} — wound up on day {day}</h2>
        <p className="muted">
          The bank called in the fleet and the books were {money(finalNetWorth)}{" "}
          short of even. It happens to most captains once.
        </p>
        <dl className="lf-plan-facts">
          <div>
            <dt>Voyages</dt>
            <dd>{state.stats.voyages}</dd>
          </div>
          <div>
            <dt>Cargo landed</dt>
            <dd>{tons(state.stats.deliveredTons)}</dd>
          </div>
          <div>
            <dt>Distance</dt>
            <dd>{nm(state.stats.milesSailed)}</dd>
          </div>
          <div>
            <dt>Souls rescued</dt>
            <dd>{state.stats.rescues}</dd>
          </div>
          <div>
            <dt>Hand dockings</dt>
            <dd>{state.stats.manualDockings}</dd>
          </div>
        </dl>
        <div className="row">
          <button type="button" className="lf-primary" onClick={onFoundAgain}>
            Found a new company
          </button>
        </div>
      </section>
      <RecentReports state={state} />
    </div>
  );
}
