import { port } from "../world";
import { arrivalOf, voyageOf, type LandfallState, type Ship } from "../state";
import type { Apply } from "./PortScreen";

/** One line of plain English for where a hull stands. */
export function shipStatus(state: LandfallState, ship: Ship): string {
  if (ship.chartered) return "on charter";

  const arrival = arrivalOf(state, ship.id);
  if (arrival) return `roads · ${port(arrival.portId).name}`;

  const voyage = voyageOf(state, ship.id);
  if (voyage?.pendingEvent) return "needs the captain";
  if (voyage) return "at sea";

  if (ship.port) return `in ${port(ship.port).name}`;
  return "at sea"; // No berth and no passage on record — treat her as away.
}

/**
 * Switch which hull the player is commanding. Available in port, at sea and
 * in the roads so a second ship can cast off while the first is still under
 * way — or so a noon report on another ship can be answered.
 */
export function FleetStrip({
  state,
  apply,
  onSwitch,
}: {
  state: LandfallState;
  apply: Apply;
  /** Called before the switch — e.g. to clear a half-built departure plan. */
  onSwitch?: () => void;
}) {
  if (state.ships.length === 0) return null;
  return (
    <div className="lf-fleet" role="tablist" aria-label="Fleet">
      {state.ships.map((ship) => {
        const underCommand = ship.id === state.activeShipId;
        const needsCaptain = voyageOf(state, ship.id)?.pendingEvent != null;

        const classes = ["lf-fleet__ship"];
        if (underCommand) classes.push("lf-fleet__ship--on");
        if (needsCaptain) classes.push("lf-fleet__ship--alert");

        return (
          <button
            key={ship.id}
            type="button"
            role="tab"
            aria-selected={underCommand}
            className={classes.join(" ")}
            onClick={() => {
              onSwitch?.();
              apply((s) => ({ ...s, activeShipId: ship.id }));
            }}
          >
            <strong>{ship.name}</strong>
            <span className="muted small">{shipStatus(state, ship)}</span>
          </button>
        );
      })}
    </div>
  );
}
