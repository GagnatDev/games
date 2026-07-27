import { useMemo, useState } from "react";
import { randomSeed } from "../rng";
import { PORTS, port, shipModel } from "../world";
import { foundingOffers, type ShipOffer } from "../economy";
import { newGameState, type LandfallState } from "../state";
import { WorldMap } from "./WorldMap";
import { money, tons, knots } from "./format";

const COMPANY_IDEAS = [
  "Blue Meridian Lines",
  "Corposant & Co.",
  "Halcyon Freight",
  "Trade Wind Shipping",
  "Ledger & Tide",
  "Southern Cross Carriers",
];

/**
 * Founding day: name the company, pick a home port off the chart, choose the
 * first hull, and cast the whole thing into a fresh save.
 */
export function SetupScreen({
  startingCapital,
  onFound,
}: {
  startingCapital: number;
  onFound: (state: LandfallState) => void;
}) {
  // One seed for the whole founding, drawn once — the offers hold still.
  const [seed] = useState(randomSeed);
  const [company, setCompany] = useState(
    () => COMPANY_IDEAS[Math.floor(Math.random() * COMPANY_IDEAS.length)]!,
  );
  const [homePort, setHomePort] = useState("rotterdam");
  const [offerId, setOfferId] = useState<string | null>(null);
  const [shipName, setShipName] = useState("");

  const offers = useMemo(
    () => foundingOffers(seed, startingCapital),
    [seed, startingCapital],
  );
  const chosen: ShipOffer | null = offers.find((o) => o.id === offerId) ?? null;

  const ready = company.trim().length > 0 && chosen !== null;

  function found() {
    if (!chosen) return;
    onFound(
      newGameState({
        company: company.trim(),
        homePort,
        seed,
        cash: startingCapital - chosen.price,
        ship: {
          id: `ship-${seed.toString(36)}-1`,
          name: shipName.trim() || chosen.name,
          model: chosen.model.id,
          condition: chosen.condition,
          fuel: Math.round(chosen.model.fuelTank * 0.4),
        },
      }),
    );
  }

  return (
    <div className="lf-setup stack">
      <div className="card lf-panel stack">
        <h2>Found the company</h2>
        <p className="muted">
          The bank advances {money(startingCapital)}. Buy a ship with it, keep
          the rest as working capital, and try to out-trade the tide.
        </p>
        <label className="lf-field">
          <span>Company name</span>
          <input
            type="text"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            maxLength={40}
          />
        </label>
      </div>

      <div className="card lf-panel stack">
        <h2>Home port</h2>
        <p className="muted small">
          Pick it off the chart. Big ports stage more cargo; the flag is yours
          either way.
        </p>
        <WorldMap here={homePort} selectable onSelectPort={setHomePort} />
        <p className="lf-setup__port">
          <strong>{port(homePort).name}</strong>, {port(homePort).country}
          <span className="muted small">
            {" "}
            · market size {"◆".repeat(port(homePort).size)}
            {" · bunkers "}${port(homePort).fuelPrice}/t
          </span>
        </p>
        <div className="lf-portpick" role="listbox" aria-label="Home port">
          {[...PORTS]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((p) => (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={p.id === homePort}
                className={`lf-chip${p.id === homePort ? " lf-chip--on" : ""}`}
                onClick={() => setHomePort(p.id)}
              >
                {p.name}
              </button>
            ))}
        </div>
      </div>

      <div className="card lf-panel stack">
        <h2>The first ship</h2>
        <p className="muted small">
          What the used market has within reach. None of them is young; all of
          them float.
        </p>
        <div className="lf-offers">
          {offers.map((offer) => {
            const model = offer.model;
            return (
              <button
                key={offer.id}
                type="button"
                className={`lf-offer${offer.id === offerId ? " lf-offer--on" : ""}`}
                onClick={() => setOfferId(offer.id)}
                aria-pressed={offer.id === offerId}
              >
                <span className="lf-offer__head">
                  <strong>{offer.name}</strong>
                  <span className="lf-offer__price">{money(offer.price)}</span>
                </span>
                <span className="muted small">{model.name}</span>
                <ShipFacts modelId={model.id} condition={offer.condition} />
              </button>
            );
          })}
        </div>
        <label className="lf-field">
          <span>Rename her (optional)</span>
          <input
            type="text"
            value={shipName}
            onChange={(event) => setShipName(event.target.value)}
            placeholder={chosen?.name ?? "Pick a hull first"}
            maxLength={30}
          />
        </label>
      </div>

      <div className="row">
        <button type="button" className="lf-primary" disabled={!ready} onClick={found}>
          Sign the papers
        </button>
        {chosen && (
          <span className="muted small">
            Working capital after purchase: {money(startingCapital - chosen.price)}
          </span>
        )}
      </div>
    </div>
  );
}

export function ShipFacts({
  modelId,
  condition,
}: {
  modelId: string;
  condition: number;
}) {
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
        <em>Holds</em> {model.carries.join(", ")}
      </span>
      <span className="lf-condition">
        <em>Condition</em>
        <span className="lf-meter">
          <span
            className={condition < 40 ? "lf-meter--bad" : undefined}
            style={{ width: `${condition}%` }}
          />
        </span>
        {Math.round(condition)}%
      </span>
    </span>
  );
}
