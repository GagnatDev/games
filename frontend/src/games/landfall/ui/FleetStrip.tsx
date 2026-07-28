import { port } from "../world";
import { arrivalOf, voyageOf, type LandfallState } from "../state";
import type { Apply } from "./PortScreen";

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
  onSwitch?: () => void;
}) {
  if (state.ships.length === 0) return null;
  return (
    <div className="lf-fleet" role="tablist" aria-label="Fleet">
      {state.ships.map((ship) => {
        const on = ship.id === state.activeShipId;
        const voyage = voyageOf(state, ship.id);
        const arrival = arrivalOf(state, ship.id);
        let status: string;
        if (ship.chartered) status = "on charter";
        else if (arrival) status = `roads · ${port(arrival.portId).name}`;
        else if (voyage?.pendingEvent) status = "needs the captain";
        else if (voyage) status = "at sea";
        else if (ship.port) status = `in ${port(ship.port).name}`;
        else status = "at sea";

        return (
          <button
            key={ship.id}
            type="button"
            role="tab"
            aria-selected={on}
            className={`lf-fleet__ship${on ? " lf-fleet__ship--on" : ""}${voyage?.pendingEvent ? " lf-fleet__ship--alert" : ""}`}
            onClick={() => {
              onSwitch?.();
              apply((s) => ({ ...s, activeShipId: ship.id }));
            }}
          >
            <strong>{ship.name}</strong>
            <span className="muted small">{status}</span>
          </button>
        );
      })}
    </div>
  );
}
