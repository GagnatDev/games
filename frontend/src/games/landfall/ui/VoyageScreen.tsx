import { useEffect, useRef, useState } from "react";
import { cargo, port, shipModel } from "../world";
import { positionAlong, type Route } from "../nav";
import {
  advanceDay,
  dayIsBlocked,
  fuelPerDayAt,
  resolveEvent,
  type EventChoice,
} from "../voyage";
import { voyageOf, type LandfallState, type PendingEvent, type Voyage } from "../state";
import type { Apply } from "./PortScreen";
import { WorldMap } from "./WorldMap";
import { FleetStrip } from "./FleetStrip";
import { days, knots, money, nm, tons } from "./format";

const SAIL_THROUGH_MS = 650;

/**
 * The passage: the chart with the ship inching along her track, the day
 * counter, and the noon reports. Any report that needs the captain stops the
 * clock until a choice is made. Sister ships keep sailing on the same days.
 */
export function VoyageScreen({ state, apply }: { state: LandfallState; apply: Apply }) {
  const shipId = state.activeShipId;
  const voyage = shipId ? voyageOf(state, shipId) : undefined;
  if (!voyage) return null;
  const ship = state.ships.find((s) => s.id === voyage.shipId);
  if (!ship) return null;

  return <VoyageView state={state} voyage={voyage} apply={apply} />;
}

function VoyageView({
  state,
  voyage,
  apply,
}: {
  state: LandfallState;
  voyage: Voyage;
  apply: Apply;
}) {
  const ship = state.ships.find((s) => s.id === voyage.shipId)!;
  const model = shipModel(ship.model);
  const destination = voyage.legs[voyage.legs.length - 1]!;
  const origin = voyage.legs[0]!;

  const route: Route = {
    legs: voyage.legs,
    distanceNm: voyage.distanceNm,
    canals: [],
    piracy: voyage.piracy,
  };
  const progress = voyage.coveredNm / voyage.distanceNm;
  const at = positionAlong(route, voyage.coveredNm);

  const remainingNm = voyage.distanceNm - voyage.coveredNm;
  const daysLeft = Math.max(1, Math.ceil(remainingNm / (voyage.speed * 24)));
  const burnPerDay = fuelPerDayAt(ship.model, voyage.speed);
  const fuelDays = burnPerDay > 0 ? Math.floor(ship.fuel / burnPerDay) : 99;

  const [sailing, setSailing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // "Sail through": tick a day on an interval until something needs a hand.
  useEffect(() => {
    if (!sailing) return;
    timer.current = setInterval(() => apply(advanceDay), SAIL_THROUGH_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [sailing, apply]);

  // One open noon report anywhere in the fleet holds the company calendar.
  const fleetHeld = dayIsBlocked(state);
  // ...and if it is not this hull's report, it can only be answered elsewhere.
  const heldByAnotherShip = fleetHeld && !voyage.pendingEvent;

  useEffect(() => {
    if (fleetHeld && sailing) setSailing(false);
  }, [fleetHeld, sailing]);

  const eta = state.day + daysLeft;
  const deadline = voyage.contract?.deadlineDay ?? null;

  return (
    <div className="lf-voyage stack">
      <WorldMap
        here={origin}
        destination={destination}
        route={{ legs: voyage.legs, progress }}
        ship={at}
      />

      <FleetStrip state={state} apply={apply} />

      <section className="card lf-panel stack" aria-label="Passage">
        <header className="lf-panel__head">
          <div>
            <h2>
              {ship.name} — {port(origin).name} to {port(destination).name}
            </h2>
            <p className="muted small">
              {voyage.contract
                ? `${tons(voyage.contract.tons)} of ${cargo(voyage.contract.cargo).name.toLowerCase()} under hatches`
                : "In ballast"}
              {" · "}
              {knots(voyage.speed)}
              {state.voyages.length > 1 && (
                <>
                  {" · "}
                  {state.voyages.length} ships under way
                </>
              )}
            </p>
          </div>
          <div className="lf-voyage__day" aria-label={`Day ${voyage.dayAtSea} at sea`}>
            <span>day at sea</span>
            <strong>{voyage.dayAtSea}</strong>
          </div>
        </header>

        <dl className="lf-plan-facts">
          <div>
            <dt>Run</dt>
            <dd>
              {nm(voyage.coveredNm)} <span className="muted small">of {nm(voyage.distanceNm)}</span>
            </dd>
          </div>
          <div>
            <dt>To go</dt>
            <dd>
              {nm(remainingNm)} · ~{days(daysLeft)}
            </dd>
          </div>
          <div>
            <dt>ETA</dt>
            <dd className={deadline !== null && eta > deadline ? "lf-bad" : undefined}>
              day {eta}
              {deadline !== null && <span className="muted small"> / due {deadline}</span>}
            </dd>
          </div>
          <div>
            <dt>Bunkers</dt>
            <dd className={fuelDays < daysLeft ? "lf-bad" : undefined}>
              {tons(ship.fuel)} <span className="muted small">~{days(fuelDays)}</span>
            </dd>
          </div>
          {voyage.lostTons > 0 && (
            <div>
              <dt>Cargo lost</dt>
              <dd className="lf-bad">{tons(voyage.lostTons)}</dd>
            </div>
          )}
        </dl>

        {heldByAnotherShip && (
          <p className="lf-warn">
            Another ship needs the captain before the fleet can sail on. Switch
            hulls on the strip above.
          </p>
        )}

        {voyage.pendingEvent ? (
          <NoonReport
            event={voyage.pendingEvent}
            speed={voyage.speed}
            maxSpeed={model.maxSpeed}
            shipId={voyage.shipId}
            apply={apply}
          />
        ) : (
          <div className="row">
            <button
              type="button"
              className="lf-primary"
              disabled={heldByAnotherShip}
              onClick={() => apply(advanceDay)}
            >
              Sail on — one day
            </button>
            <button
              type="button"
              className={sailing ? undefined : "ghost"}
              disabled={heldByAnotherShip}
              onClick={() => setSailing((v) => !v)}
              aria-pressed={sailing}
            >
              {sailing ? "Belay that — take it slow" : "Sail through"}
            </button>
          </div>
        )}
      </section>

      <RecentReports state={state} />
    </div>
  );
}

/** The report that stops the clock, with the captain's options. */
function NoonReport({
  event,
  speed,
  maxSpeed,
  shipId,
  apply,
}: {
  event: PendingEvent;
  speed: number;
  maxSpeed: number;
  shipId: string;
  apply: Apply;
}) {
  const choose = (choice: EventChoice) => () =>
    apply((s) => resolveEvent(s, choice, shipId), true);

  switch (event.kind) {
    case "storm":
      return (
        <EventCard
          title="Heavy weather"
          body="The glass is falling and the sea is getting up. Press on through it, or heave to and let it blow itself out?"
        >
          <button type="button" onClick={choose("press-on")}>
            Press on
          </button>
          <button type="button" className="ghost" onClick={choose("heave-to")}>
            Heave to — lose a day
          </button>
        </EventCard>
      );
    case "pirates":
      return (
        <EventCard
          title="Pirates"
          body={`A fast skiff is closing and answering no hails. They will take $${event.tribute.toLocaleString("en-US")} to lose interest — or she can run for it.`}
        >
          <button type="button" onClick={choose("run")}>
            Run for it{speed >= maxSpeed - 1 ? " — she has the legs" : ""}
          </button>
          <button type="button" className="ghost" onClick={choose("pay-tribute")}>
            Pay {money(event.tribute)}
          </button>
        </EventCard>
      );
    case "engine":
      return (
        <EventCard
          title="Breakdown"
          body={`The engineers need half a day and parts. The bill comes to ${money(event.cost)}.`}
        >
          <button type="button" onClick={choose("acknowledge")}>
            Make the repairs
          </button>
        </EventCard>
      );
    case "rescue":
      return (
        <EventCard
          title="Distress flare"
          body="A liferaft on the swell, two points off the bow. Diverting costs hours; leaving them costs something else."
        >
          <button type="button" onClick={choose("divert")}>
            Bring her about
          </button>
          <button type="button" className="ghost" onClick={choose("sail-past")}>
            Hold the course
          </button>
        </EventCard>
      );
    case "fuel":
      return (
        <EventCard
          title="Bunkers dry"
          body={`The last ton went through the burners. A salvage tug will bring her in — for ${money(event.cost)}.`}
        >
          <button type="button" onClick={choose("acknowledge")}>
            Take the tow
          </button>
        </EventCard>
      );
  }
}

function EventCard({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="lf-event" role="alertdialog" aria-label={title}>
      <h3>{title}</h3>
      <p>{body}</p>
      <div className="row">{children}</div>
    </div>
  );
}

/** The last few log lines, newest first — the noon report feed. */
export function RecentReports({ state }: { state: LandfallState }) {
  return (
    <section className="card lf-panel stack" aria-label="Recent reports">
      <h2>Reports</h2>
      <ol className="lf-log" role="list">
        {[...state.log].slice(-6).reverse().map((entry, i) => (
          <li key={`${entry.day}-${i}`} className={`lf-log__entry lf-log__entry--${entry.tone}`}>
            <span className="lf-log__day">d{entry.day}</span>
            <span>{entry.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
