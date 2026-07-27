import { useMemo, useState } from "react";
import { PORTS, cargo, port, shipModel } from "../world";
import {
  canalFreeRoute,
  shortestRoute,
  type Route,
} from "../nav";
import {
  charterRate,
  buyShip,
  freightMarket,
  maxLoan,
  refuel,
  repair,
  repairCostPerPoint,
  repayLoan,
  sellShip,
  setChartered,
  shipValue,
  shipyard,
  takeLoan,
  waitDay,
} from "../economy";
import { canCarry, depart, effectiveMaxSpeed, estimateVoyage } from "../voyage";
import { activeShip, type Contract, type LandfallState, type Ship } from "../state";
import { WorldMap } from "./WorldMap";
import { days, knots, money, nm, tons } from "./format";

export type Apply = (
  mutate: (state: LandfallState) => LandfallState,
  immediate?: boolean,
) => void;

type Tab = "market" | "ship" | "yard" | "bank" | "log";

/**
 * Life alongside: the freight market, the ship's own business, the yard, the
 * bank and the log — with the chart above previewing whatever the player is
 * about to commit to.
 */
export function PortScreen({ state, apply }: { state: LandfallState; apply: Apply }) {
  const [tab, setTab] = useState<Tab>("market");
  const ship = activeShip(state);

  // Departure planning state.
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [ballastTo, setBallastTo] = useState<string | null>(null);
  const [speed, setSpeed] = useState<number | null>(null);
  const [viaCanal, setViaCanal] = useState(true);

  if (!ship) {
    return <Beached state={state} apply={apply} />;
  }
  const here = ship.port;
  if (here === null) return null; // voyage phase owns this ship

  const market = freightMarket(state, here);
  const planContract: Contract | null =
    planKey === "ballast" ? null : (market.find((c) => c.id === planKey) ?? null);
  const destination = planKey === "ballast" ? ballastTo : (planContract?.to ?? null);

  function resetPlan() {
    setPlanKey(null);
    setBallastTo(null);
    setSpeed(null);
    setViaCanal(true);
  }

  const bestRoute = destination ? shortestRoute(here, destination) : null;
  const aroundRoute = destination ? canalFreeRoute(here, destination) : null;
  const route: Route | null = viaCanal ? bestRoute : (aroundRoute ?? bestRoute);

  return (
    <div className="lf-port stack">
      <WorldMap
        here={here}
        destination={destination}
        route={route ? { legs: route.legs } : null}
      />

      <FleetStrip state={state} apply={apply} onSwitch={resetPlan} />

      <nav className="lf-tabs" role="tablist" aria-label="Port business">
        {(
          [
            ["market", "Freight market"],
            ["ship", "Ship"],
            ["yard", "Shipyard"],
            ["bank", "Bank"],
            ["log", "Log"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`lf-tab${tab === id ? " lf-tab--on" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "market" && (
        <section className="card lf-panel stack" aria-label="Freight market">
          <header className="lf-panel__head">
            <div>
              <h2>{port(here).name} freight market</h2>
              <p className="muted small">
                Day {state.day}. New offers post every morning.
              </p>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                resetPlan();
                apply(waitDay);
              }}
            >
              Wait a day
            </button>
          </header>

          <ul className="lf-contracts" role="list">
            {market.map((contract) => {
              const problem = canCarry(ship, contract);
              const open = planKey === contract.id;
              return (
                <li key={contract.id}>
                  <button
                    type="button"
                    className={`lf-contract${open ? " lf-contract--on" : ""}`}
                    disabled={problem !== null}
                    title={problem ?? undefined}
                    onClick={() => {
                      setPlanKey(open ? null : contract.id);
                      setBallastTo(null);
                      setSpeed(null);
                      setViaCanal(true);
                    }}
                  >
                    <span className="lf-contract__cargo">
                      <strong>{cargo(contract.cargo).name}</strong>
                      <span className="muted">{tons(contract.tons)}</span>
                    </span>
                    <span className="lf-contract__to">
                      → {port(contract.to).name}
                      <span className="muted small">{port(contract.to).country}</span>
                    </span>
                    <span className="lf-contract__pay">
                      <strong>{money(contract.payment)}</strong>
                      <span className="muted small">
                        ${contract.ratePerTon.toFixed(2)}/t
                      </span>
                    </span>
                    {contract.deadlineDay !== null && (
                      <span className="lf-deadline">
                        by day {contract.deadlineDay}
                      </span>
                    )}
                    {problem && <span className="lf-contract__no">{problem}</span>}
                  </button>
                  {open && route && (
                    <DeparturePlanner
                      state={state}
                      ship={ship}
                      contract={contract}
                      route={route}
                      aroundRoute={aroundRoute}
                      viaCanal={viaCanal}
                      setViaCanal={setViaCanal}
                      speed={speed}
                      setSpeed={setSpeed}
                      apply={apply}
                      onDone={resetPlan}
                    />
                  )}
                </li>
              );
            })}
          </ul>

          <details
            className="lf-ballast"
            open={planKey === "ballast"}
            onToggle={(event) => {
              if ((event.target as HTMLDetailsElement).open) {
                setPlanKey("ballast");
                setSpeed(null);
              } else if (planKey === "ballast") {
                resetPlan();
              }
            }}
          >
            <summary>Sail in ballast — reposition without cargo</summary>
            <div className="lf-portpick" role="listbox" aria-label="Ballast destination">
              {PORTS.filter((p) => p.id !== here)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={ballastTo === p.id}
                    className={`lf-chip${ballastTo === p.id ? " lf-chip--on" : ""}`}
                    onClick={() => {
                      setBallastTo(p.id);
                      setSpeed(null);
                      setViaCanal(true);
                    }}
                  >
                    {p.name}
                  </button>
                ))}
            </div>
            {planKey === "ballast" && ballastTo && route && (
              <DeparturePlanner
                state={state}
                ship={ship}
                contract={null}
                route={route}
                aroundRoute={aroundRoute}
                viaCanal={viaCanal}
                setViaCanal={setViaCanal}
                speed={speed}
                setSpeed={setSpeed}
                apply={apply}
                onDone={resetPlan}
              />
            )}
          </details>
        </section>
      )}

      {tab === "ship" && <ShipTab state={state} ship={ship} apply={apply} />}
      {tab === "yard" && <YardTab state={state} here={here} apply={apply} />}
      {tab === "bank" && <BankTab state={state} apply={apply} />}
      {tab === "log" && <LogTab state={state} />}
    </div>
  );
}

// ── Departure planner ────────────────────────────────────────────────────────

function DeparturePlanner({
  state,
  ship,
  contract,
  route,
  aroundRoute,
  viaCanal,
  setViaCanal,
  speed,
  setSpeed,
  apply,
  onDone,
}: {
  state: LandfallState;
  ship: Ship;
  contract: Contract | null;
  route: Route;
  aroundRoute: Route | null;
  viaCanal: boolean;
  setViaCanal: (via: boolean) => void;
  speed: number | null;
  setSpeed: (speed: number) => void;
  apply: Apply;
  onDone: () => void;
}) {
  const model = shipModel(ship.model);
  const maxSpeed = effectiveMaxSpeed(ship);
  const chosenSpeed = Math.min(speed ?? model.cruiseSpeed, maxSpeed);
  const estimate = estimateVoyage(ship, contract, route, chosenSpeed);
  const eta = state.day + estimate.days;
  const late = contract?.deadlineDay != null && eta > contract.deadlineDay;
  const fuelShort = Math.max(0, estimate.fuelTons - ship.fuel);
  const cannotPayTolls = estimate.tolls > state.cash;
  const chartered = ship.chartered;

  return (
    <div className="lf-planner stack" aria-label="Departure plan">
      {aroundRoute && (
        <div className="lf-planner__via" role="radiogroup" aria-label="Routing">
          <button
            type="button"
            role="radio"
            aria-checked={viaCanal}
            className={`lf-chip${viaCanal ? " lf-chip--on" : ""}`}
            onClick={() => setViaCanal(true)}
          >
            Via {route.canals.length > 0 || viaCanal ? canalNames(route, aroundRoute) : "canal"}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!viaCanal}
            className={`lf-chip${!viaCanal ? " lf-chip--on" : ""}`}
            onClick={() => setViaCanal(false)}
          >
            Around — no tolls, {nm(aroundRoute.distanceNm)}
          </button>
        </div>
      )}

      <label className="lf-speed">
        <span>
          Speed <strong>{knots(chosenSpeed)}</strong>
          <span className="muted small"> · max {knots(maxSpeed)}</span>
        </span>
        <input
          type="range"
          min={8}
          max={maxSpeed}
          step={0.5}
          value={chosenSpeed}
          onChange={(event) => setSpeed(Number(event.target.value))}
        />
      </label>

      <dl className="lf-plan-facts">
        <div>
          <dt>Distance</dt>
          <dd>{nm(route.distanceNm)}</dd>
        </div>
        <div>
          <dt>Passage</dt>
          <dd>
            {days(estimate.days)} · ETA day {eta}
          </dd>
        </div>
        <div>
          <dt>Fuel</dt>
          <dd className={fuelShort > 0 ? "lf-bad" : undefined}>
            {tons(estimate.fuelTons)} <span className="muted small">of {tons(ship.fuel)} aboard</span>
          </dd>
        </div>
        {estimate.tolls > 0 && (
          <div>
            <dt>Canal dues</dt>
            <dd>{money(estimate.tolls)}</dd>
          </div>
        )}
        {contract && (
          <div>
            <dt>Est. profit</dt>
            <dd className={estimate.expectedProfit < 0 ? "lf-bad" : "lf-good"}>
              {money(estimate.expectedProfit)}
            </dd>
          </div>
        )}
      </dl>

      {late && contract && (
        <p className="lf-warn">
          At this speed she arrives after day {contract.deadlineDay} — the
          charterer will dock the payment.
        </p>
      )}
      {fuelShort > 0 && (
        <p className="lf-warn">
          Short {tons(fuelShort)} of bunkers for the passage. She can sail, but
          the sea does not sell fuel.
        </p>
      )}
      {chartered && <p className="lf-warn">She is fixed on charter — release her first.</p>}
      {cannotPayTolls && <p className="lf-warn">The canal dues exceed the cash box.</p>}

      <div className="row">
        <button
          type="button"
          className="lf-primary"
          disabled={chartered || cannotPayTolls}
          onClick={() => {
            apply(
              (s) =>
                depart(s, {
                  ship,
                  contract,
                  route,
                  speed: chosenSpeed,
                }),
              true,
            );
            onDone();
          }}
        >
          Cast off
        </button>
        <button type="button" className="ghost" onClick={onDone}>
          Never mind
        </button>
      </div>
    </div>
  );
}

function canalNames(route: Route, around: Route | null): string {
  const canals = route.canals.length > 0 ? route.canals : (around ? ["canal"] : []);
  const names = canals.map((c) => (c === "suez" ? "Suez" : c === "panama" ? "Panama" : c));
  return `${[...new Set(names)].join(" & ")} — ${nm(route.distanceNm)}`;
}

// ── Fleet strip ──────────────────────────────────────────────────────────────

function FleetStrip({
  state,
  apply,
  onSwitch,
}: {
  state: LandfallState;
  apply: Apply;
  onSwitch: () => void;
}) {
  if (state.ships.length === 0) return null;
  return (
    <div className="lf-fleet" role="tablist" aria-label="Fleet">
      {state.ships.map((ship) => {
        const on = ship.id === state.activeShipId;
        return (
          <button
            key={ship.id}
            type="button"
            role="tab"
            aria-selected={on}
            className={`lf-fleet__ship${on ? " lf-fleet__ship--on" : ""}`}
            onClick={() => {
              onSwitch();
              apply((s) => ({ ...s, activeShipId: ship.id }));
            }}
          >
            <strong>{ship.name}</strong>
            <span className="muted small">
              {ship.chartered
                ? "on charter"
                : ship.port
                  ? `in ${port(ship.port).name}`
                  : "at sea"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Ship tab ─────────────────────────────────────────────────────────────────

function ShipTab({
  state,
  ship,
  apply,
}: {
  state: LandfallState;
  ship: Ship;
  apply: Apply;
}) {
  const model = shipModel(ship.model);
  const here = port(ship.port!);
  const fillTons = Math.ceil(model.fuelTank - ship.fuel);
  const perPoint = repairCostPerPoint(model);
  const toFix = Math.round(100 - ship.condition);
  const value = shipValue(model, ship.condition);

  return (
    <section className="card lf-panel stack" aria-label="Ship">
      <header className="lf-panel__head">
        <div>
          <h2>
            {ship.name} <span className="muted">· {model.name}</span>
          </h2>
          <p className="muted small">
            {tons(model.dwt)} · holds: {model.carries.join(", ")} · valued at{" "}
            {money(value)}
          </p>
        </div>
      </header>

      <div className="lf-shipmeters">
        <div className="lf-shipmeter">
          <span className="lf-shipmeter__label">
            Condition <strong>{Math.round(ship.condition)}%</strong>
          </span>
          <span className="lf-meter lf-meter--tall">
            <span
              className={ship.condition < 40 ? "lf-meter--bad" : undefined}
              style={{ width: `${ship.condition}%` }}
            />
          </span>
        </div>
        <div className="lf-shipmeter">
          <span className="lf-shipmeter__label">
            Bunkers <strong>{tons(ship.fuel)}</strong>
            <span className="muted small"> / {tons(model.fuelTank)}</span>
          </span>
          <span className="lf-meter lf-meter--tall">
            <span style={{ width: `${(ship.fuel / model.fuelTank) * 100}%` }} />
          </span>
        </div>
      </div>

      <div className="lf-actions">
        <div className="lf-action">
          <h3>Bunkers — ${here.fuelPrice}/t here</h3>
          <div className="row row--tight">
            <button
              type="button"
              className="ghost"
              disabled={fillTons <= 0}
              onClick={() => apply((s) => refuel(s, ship.id, Math.min(50, fillTons)))}
            >
              +50t ({money(Math.min(50, Math.max(0, fillTons)) * here.fuelPrice)})
            </button>
            <button
              type="button"
              disabled={fillTons <= 0}
              onClick={() => apply((s) => refuel(s, ship.id, fillTons))}
            >
              Fill her up ({money(fillTons * here.fuelPrice)})
            </button>
          </div>
        </div>

        <div className="lf-action">
          <h3>Yard — {money(perPoint)} a point, a day per 12</h3>
          <div className="row row--tight">
            <button
              type="button"
              className="ghost"
              disabled={toFix <= 0}
              onClick={() => apply((s) => repair(s, ship.id, Math.min(12, toFix)))}
            >
              Patch +12 ({money(Math.min(12, toFix) * perPoint)})
            </button>
            <button
              type="button"
              disabled={toFix <= 0}
              onClick={() => apply((s) => repair(s, ship.id, toFix))}
            >
              Full refit ({money(toFix * perPoint)})
            </button>
          </div>
        </div>

        <div className="lf-action">
          <h3>Charter — {money(charterRate(ship))} a day, crew found</h3>
          <div className="row row--tight">
            <button
              type="button"
              className="ghost"
              onClick={() => apply((s) => setChartered(s, ship.id, !ship.chartered))}
            >
              {ship.chartered ? "Take her off charter" : "Fix her on time charter"}
            </button>
          </div>
        </div>

        <div className="lf-action">
          <h3>Sale — the broker keeps 8%</h3>
          <div className="row row--tight">
            <button
              type="button"
              className="ghost lf-danger"
              onClick={() => apply((s) => sellShip(s, ship.id), true)}
            >
              Sell for {money(Math.round(value * 0.92))}
            </button>
            {state.ships.length === 1 && (
              <span className="muted small">She is the whole fleet.</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Shipyard tab ─────────────────────────────────────────────────────────────

function YardTab({
  state,
  here,
  apply,
}: {
  state: LandfallState;
  here: string;
  apply: Apply;
}) {
  const offers = shipyard(state, here);
  const [naming, setNaming] = useState<string | null>(null);
  const [name, setName] = useState("");

  return (
    <section className="card lf-panel stack" aria-label="Shipyard">
      <header className="lf-panel__head">
        <div>
          <h2>{port(here).name} shipyard</h2>
          <p className="muted small">
            The board turns over weekly. Cash sales only.
          </p>
        </div>
      </header>

      {offers.length === 0 && (
        <p className="muted">
          No yard here — try a bigger port. {port(here).name} handles cargo, not
          hulls.
        </p>
      )}

      <div className="lf-offers">
        {offers.map((offer) => {
          const affordable = offer.price <= state.cash;
          const open = naming === offer.id;
          return (
            <div key={offer.id} className={`lf-offer lf-offer--card${open ? " lf-offer--on" : ""}`}>
              <span className="lf-offer__head">
                <strong>{offer.name}</strong>
                <span className="lf-offer__price">{money(offer.price)}</span>
              </span>
              <span className="muted small">{offer.model.name}</span>
              <YardFacts modelId={offer.model.id} condition={offer.condition} />
              {!open && (
                <button
                  type="button"
                  className="ghost"
                  disabled={!affordable}
                  onClick={() => {
                    setNaming(offer.id);
                    setName(offer.name);
                  }}
                >
                  {affordable ? "Survey & buy" : "Beyond the cash box"}
                </button>
              )}
              {open && (
                <div className="stack">
                  <label className="lf-field">
                    <span>Name her</span>
                    <input
                      type="text"
                      value={name}
                      maxLength={30}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <div className="row row--tight">
                    <button
                      type="button"
                      onClick={() => {
                        apply((s) => buyShip(s, offer, here, name), true);
                        setNaming(null);
                      }}
                    >
                      Buy for {money(offer.price)}
                    </button>
                    <button type="button" className="ghost" onClick={() => setNaming(null)}>
                      Walk away
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function YardFacts({ modelId, condition }: { modelId: string; condition: number }) {
  const model = shipModel(modelId);
  return (
    <span className="lf-facts">
      <span>
        <em>Capacity</em> {tons(model.dwt)}
      </span>
      <span>
        <em>Top speed</em> {knots(model.maxSpeed)}
      </span>
      <span>
        <em>Crew</em> {money(model.crewPerDay)}/day
      </span>
      <span className="lf-condition">
        <em>Condition</em>
        <span className="lf-meter">
          <span
            className={condition < 40 ? "lf-meter--bad" : undefined}
            style={{ width: `${condition}%` }}
          />
        </span>
        {condition}%
      </span>
    </span>
  );
}

// ── Bank tab ─────────────────────────────────────────────────────────────────

function BankTab({ state, apply }: { state: LandfallState; apply: Apply }) {
  const [amount, setAmount] = useState(100_000);
  const ceiling = maxLoan(state);
  const headroom = Math.max(0, ceiling - state.loan);

  return (
    <section className="card lf-panel stack" aria-label="Bank">
      <header className="lf-panel__head">
        <div>
          <h2>The bank</h2>
          <p className="muted small">
            0.06% a day against the fleet. The ledger never sleeps.
          </p>
        </div>
      </header>

      <dl className="lf-plan-facts">
        <div>
          <dt>Outstanding</dt>
          <dd>{money(state.loan)}</dd>
        </div>
        <div>
          <dt>Credit line</dt>
          <dd>{money(ceiling)}</dd>
        </div>
        <div>
          <dt>Headroom</dt>
          <dd>{money(headroom)}</dd>
        </div>
        <div>
          <dt>Interest / day</dt>
          <dd>{money(Math.round(state.loan * 0.0006))}</dd>
        </div>
      </dl>

      <label className="lf-field">
        <span>Amount</span>
        <input
          type="range"
          min={25_000}
          max={Math.max(50_000, Math.max(headroom, Math.min(state.loan, state.cash)))}
          step={25_000}
          value={amount}
          onChange={(event) => setAmount(Number(event.target.value))}
        />
        <strong>{money(amount)}</strong>
      </label>

      <div className="row">
        <button
          type="button"
          disabled={headroom <= 0}
          onClick={() => apply((s) => takeLoan(s, amount))}
        >
          Draw {money(Math.min(amount, headroom))}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={state.loan <= 0 || state.cash <= 0}
          onClick={() => apply((s) => repayLoan(s, amount))}
        >
          Repay {money(Math.min(amount, state.loan, Math.max(0, state.cash)))}
        </button>
      </div>
    </section>
  );
}

// ── Log tab ──────────────────────────────────────────────────────────────────

export function LogTab({ state }: { state: LandfallState }) {
  return (
    <section className="card lf-panel stack" aria-label="Ship's log">
      <h2>Ship&apos;s log</h2>
      <ol className="lf-log" role="list">
        {[...state.log].reverse().map((entry, i) => (
          <li key={`${entry.day}-${i}`} className={`lf-log__entry lf-log__entry--${entry.tone}`}>
            <span className="lf-log__day">d{entry.day}</span>
            <span>{entry.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── No ships at all ──────────────────────────────────────────────────────────

function Beached({ state, apply }: { state: LandfallState; apply: Apply }) {
  // Sold the last hull: the company lives while the cash does. The brokers
  // work out of the nearest real yard if the home port has none.
  const anywhere = port(state.homePort).size >= 2 ? state.homePort : "rotterdam";
  return (
    <div className="stack">
      <section className="card lf-panel stack">
        <h2>No ship under the flag</h2>
        <p className="muted">
          The company holds {money(state.cash)} and not one deck to stand on.
          Buy a hull before the office rent does what the sea could not.
        </p>
      </section>
      <YardTab state={state} here={anywhere} apply={apply} />
      <BankTab state={state} apply={apply} />
    </div>
  );
}
