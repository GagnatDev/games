import { useCallback, useEffect, useRef, useState } from "react";
import { cargo, port, shipModel } from "../world";
import { tugFee } from "../economy";
import { completeArrival } from "../voyage";
import {
  HARBORS,
  TELEGRAPH_LABELS,
  TELEGRAPH_SPEEDS,
  TELEGRAPH_STOP,
  crashDamage,
  dockShipFor,
  newDockSim,
  shipOutline,
  stepDock,
  type DockShip,
  type DockSim,
  type Harbor,
} from "../dock";
import type { LandfallState } from "../state";
import type { Apply } from "./PortScreen";
import { money, tons } from "./format";

/**
 * Landfall's namesake moment. Take the tug and pay for certainty, or take the
 * conn: telegraph and rudder, a berth marked on the water, and a hull that
 * answers slowly and remembers every wall.
 */
export function DockingScreen({ state, apply }: { state: LandfallState; apply: Apply }) {
  if (state.phase.kind !== "docking") return null;
  const arrival = state.phase.arrival;
  const ship = state.ships.find((s) => s.id === arrival.shipId);
  if (!ship) return null;

  const model = shipModel(ship.model);
  const here = port(arrival.portId);
  const harbor = HARBORS[here.harbor];
  const fee = tugFee(model.dwt);
  const canAffordTug = state.cash >= fee && !arrival.tugStrike;

  return (
    <div className="lf-docking stack">
      <section className="card lf-panel stack">
        <header className="lf-panel__head">
          <div>
            <h2>
              {here.name} roads — {harbor.name.toLowerCase()}
            </h2>
            <p className="muted small">
              {ship.name}
              {arrival.contract
                ? ` · ${tons(Math.max(0, arrival.contract.tons - arrival.lostTons))} of ${cargo(arrival.contract.cargo).name.toLowerCase()} to land`
                : " · in ballast"}
            </p>
          </div>
        </header>

        {arrival.tugStrike && (
          <p className="lf-warn">
            The tug crews walked out this morning. She goes in by hand or not at
            all.
          </p>
        )}

        <Berthing
          apply={apply}
          harbor={harbor}
          dockShip={dockShipFor(model.dwt, model.handling)}
          tugAvailable={canAffordTug}
          tugStrike={arrival.tugStrike}
          fee={fee}
        />
      </section>
    </div>
  );
}

type Mode = "choice" | "manual";

function Berthing({
  apply,
  harbor,
  dockShip,
  tugAvailable,
  tugStrike,
  fee,
}: {
  apply: Apply;
  harbor: Harbor;
  dockShip: DockShip;
  tugAvailable: boolean;
  tugStrike: boolean;
  fee: number;
}) {
  const [mode, setMode] = useState<Mode>("choice");

  const finish = useCallback(
    (outcome: Parameters<typeof completeArrival>[1]) => {
      apply((s) => completeArrival(s, outcome), true);
    },
    [apply],
  );

  if (mode === "choice") {
    return (
      <div className="stack">
        <p className="muted">
          The berth is marked on the water. Tugs cost money; walls cost more.
        </p>
        <div className="row">
          <button
            type="button"
            className="lf-primary"
            onClick={() => setMode("manual")}
            data-testid="lf-dock-manual"
          >
            Take her in by hand
          </button>
          <button
            type="button"
            className="ghost"
            disabled={!tugAvailable}
            onClick={() => finish({ method: "tug", damage: 0, emergencyTow: false })}
            data-testid="lf-dock-tug"
          >
            Hire the tug — {money(fee)}
          </button>
          {!tugAvailable && !tugStrike && (
            <span className="muted small">The cash box will not cover the tug.</span>
          )}
        </div>
      </div>
    );
  }

  return <DockingSim harbor={harbor} dockShip={dockShip} fee={fee} onDone={finish} />;
}

// ── The simulator ────────────────────────────────────────────────────────────

function DockingSim({
  harbor,
  dockShip,
  fee,
  onDone,
}: {
  harbor: Harbor;
  dockShip: DockShip;
  fee: number;
  onDone: (outcome: { method: "manual"; damage: number; emergencyTow: boolean }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<DockSim>(newDockSim(harbor));
  const inputRef = useRef({ telegraph: simRef.current.telegraph, rudder: 0 });
  const trailRef = useRef<[number, number][]>([]);
  const [hud, setHud] = useState(() => hudFrom(simRef.current, harbor));
  const [outcome, setOutcome] = useState<DockSim["outcome"]>(null);

  // Keyboard: telegraph up/down, rudder port/starboard, space amidships.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const input = inputRef.current;
      switch (event.key) {
        case "ArrowUp":
          input.telegraph = Math.min(TELEGRAPH_SPEEDS.length - 1, input.telegraph + 1);
          break;
        case "ArrowDown":
          input.telegraph = Math.max(0, input.telegraph - 1);
          break;
        case "ArrowLeft":
          input.rudder = Math.max(-1, Math.round((input.rudder - 0.25) * 4) / 4);
          break;
        case "ArrowRight":
          input.rudder = Math.min(1, Math.round((input.rudder + 0.25) * 4) / 4);
          break;
        case " ":
          input.rudder = 0;
          break;
        default:
          return;
      }
      event.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The loop: fixed-ish step physics, canvas draw, occasional HUD sync.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let hudAt = 0;

    function frame(now: number) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      let sim = simRef.current;
      if (!sim.outcome) {
        sim = stepDock(sim, inputRef.current, dockShip, harbor, dt);
        simRef.current = sim;
        if (sim.outcome) setOutcome(sim.outcome);
      }

      const trail = trailRef.current;
      if (
        Math.abs(sim.speed) > 0.2 &&
        (trail.length === 0 ||
          Math.hypot(sim.x - trail[trail.length - 1]![0], sim.y - trail[trail.length - 1]![1]) > 6)
      ) {
        trail.push([sim.x, sim.y]);
        if (trail.length > 90) trail.shift();
      }

      const canvas = canvasRef.current;
      if (canvas) draw(canvas, sim, dockShip, harbor, trail);

      if (now - hudAt > 120) {
        hudAt = now;
        setHud(hudFrom(sim, harbor));
      }

      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [dockShip, harbor]);

  const nudge = useCallback((field: "telegraph" | "rudder", delta: number) => {
    const input = inputRef.current;
    if (field === "telegraph") {
      input.telegraph = Math.max(
        0,
        Math.min(TELEGRAPH_SPEEDS.length - 1, input.telegraph + delta),
      );
    } else if (delta === 0) {
      input.rudder = 0;
    } else {
      input.rudder = Math.max(-1, Math.min(1, Math.round((input.rudder + delta) * 4) / 4));
    }
  }, []);

  return (
    <div className="lf-sim stack">
      <div className="lf-sim__stage">
        <canvas
          ref={canvasRef}
          className="lf-sim__canvas"
          width={960}
          height={560}
          role="img"
          aria-label="Harbour approach, top-down"
        />
        {outcome && (
          <div className="lf-sim__overlay" role="alertdialog">
            {outcome.kind === "docked" && (
              <>
                <p className="lf-sim__verdict lf-good">All fast.</p>
                <p className="muted">Lines ashore and the gangway down. Clean work.</p>
                <button
                  type="button"
                  className="lf-primary"
                  onClick={() => onDone({ method: "manual", damage: 0, emergencyTow: false })}
                >
                  Open the hatches
                </button>
              </>
            )}
            {outcome.kind === "crashed" && (
              <>
                <p className="lf-sim__verdict lf-bad">Hard contact.</p>
                <p className="muted">
                  She hit at {(outcome.impact * 1.94).toFixed(1)} knots. The yard and
                  the harbourmaster will both send bills.
                </p>
                <button
                  type="button"
                  className="lf-primary"
                  onClick={() =>
                    onDone({
                      method: "manual",
                      damage: crashDamage(outcome.impact),
                      emergencyTow: false,
                    })
                  }
                >
                  Survey the damage
                </button>
              </>
            )}
            {outcome.kind === "timeout" && (
              <>
                <p className="lf-sim__verdict lf-bad">The pilot takes over.</p>
                <p className="muted">
                  Out of time and out of patience — an emergency tug finishes the
                  job at {money(Math.round(fee * 1.5))}.
                </p>
                <button
                  type="button"
                  className="lf-primary"
                  onClick={() => onDone({ method: "manual", damage: 0, emergencyTow: true })}
                >
                  Settle up
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="lf-sim__hud">
        <div className="lf-sim__cluster" role="group" aria-label="Engine telegraph">
          <button type="button" className="ghost" onClick={() => nudge("telegraph", 1)} aria-label="Telegraph ahead">
            ▲
          </button>
          <span className="lf-sim__dial">{hud.telegraph}</span>
          <button type="button" className="ghost" onClick={() => nudge("telegraph", -1)} aria-label="Telegraph astern">
            ▼
          </button>
        </div>
        <div className="lf-sim__cluster" role="group" aria-label="Rudder">
          <button type="button" className="ghost" onClick={() => nudge("rudder", -0.25)} aria-label="Rudder to port">
            ◀
          </button>
          <span className="lf-sim__dial">
            {hud.rudder === 0 ? "midships" : `${Math.abs(hud.rudder * 35)}° ${hud.rudder < 0 ? "port" : "stbd"}`}
          </span>
          <button type="button" className="ghost" onClick={() => nudge("rudder", 0.25)} aria-label="Rudder to starboard">
            ▶
          </button>
          <button type="button" className="ghost" onClick={() => nudge("rudder", 0)} aria-label="Rudder amidships">
            ●
          </button>
        </div>
        <div className="lf-sim__cluster lf-sim__readouts">
          <span>
            <em>speed</em> {hud.speed}
          </span>
          <span>
            <em>time</em> {hud.timeLeft}
          </span>
        </div>
        {!outcome && (
          <button
            type="button"
            className="ghost lf-sim__abort"
            onClick={() => onDone({ method: "manual", damage: 0, emergencyTow: true })}
          >
            Give up — emergency tug {money(Math.round(fee * 1.5))}
          </button>
        )}
      </div>
      <p className="muted small">
        Arrow keys: ▲▼ telegraph, ◀▶ rudder, space for midships. Lay her inside
        the marked berth, parallel and dead slow.
      </p>
    </div>
  );
}

function hudFrom(sim: DockSim, harbor: Harbor) {
  return {
    telegraph: TELEGRAPH_LABELS[Math.round(sim.telegraph)] ?? "Stop",
    rudder: sim.rudder,
    speed: `${(Math.abs(sim.speed) * 1.94).toFixed(1)} kn${sim.speed < 0 ? " astern" : ""}`,
    timeLeft: `${Math.max(0, Math.ceil(harbor.timeLimit - sim.t))}s`,
  };
}

// ── Canvas painting ──────────────────────────────────────────────────────────

function draw(
  canvas: HTMLCanvasElement,
  sim: DockSim,
  dockShip: DockShip,
  harbor: Harbor,
  trail: readonly [number, number][],
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const sx = canvas.width / harbor.width;
  const sy = canvas.height / harbor.height;
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(sx, sy);

  // Water.
  const water = ctx.createRadialGradient(
    harbor.width / 2, harbor.height * 0.25, 60,
    harbor.width / 2, harbor.height / 2, harbor.width * 0.75,
  );
  water.addColorStop(0, "#0e2233");
  water.addColorStop(1, "#071119");
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, harbor.width, harbor.height);

  // Soundings — faint dotted grid for depth.
  ctx.fillStyle = "rgba(120,170,200,0.05)";
  for (let gx = 40; gx < harbor.width; gx += 80) {
    for (let gy = 40; gy < harbor.height; gy += 80) {
      ctx.beginPath();
      ctx.arc(gx, gy, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The berth — a glowing box on the water.
  const berth = harbor.berth;
  ctx.save();
  ctx.translate(berth.x, berth.y);
  ctx.rotate(berth.angle);
  const slotW = dockShip.beam * 3.4;
  ctx.strokeStyle = "rgba(87,196,216,0.85)";
  ctx.lineWidth = 2.4;
  ctx.setLineDash([12, 8]);
  ctx.strokeRect(-berth.length / 2, -slotW / 2, berth.length, slotW);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(87,196,216,0.07)";
  ctx.fillRect(-berth.length / 2, -slotW / 2, berth.length, slotW);
  // Alignment arrow.
  ctx.strokeStyle = "rgba(87,196,216,0.5)";
  ctx.beginPath();
  ctx.moveTo(-berth.length * 0.28, 0);
  ctx.lineTo(berth.length * 0.28, 0);
  ctx.lineTo(berth.length * 0.2, -8);
  ctx.moveTo(berth.length * 0.28, 0);
  ctx.lineTo(berth.length * 0.2, 8);
  ctx.stroke();
  ctx.restore();

  // Quays and breakwaters.
  ctx.lineCap = "square";
  for (const [x1, y1, x2, y2] of harbor.walls) {
    ctx.strokeStyle = "#2c4a5e";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.strokeStyle = "#3f6a83";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Wake.
  if (trail.length > 1) {
    ctx.strokeStyle = "rgba(150,200,220,0.18)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(trail[0]![0], trail[0]![1]);
    for (const [tx, ty] of trail.slice(1)) ctx.lineTo(tx, ty);
    ctx.stroke();
  }

  // The ship.
  const outline = shipOutline(sim, dockShip);
  ctx.beginPath();
  ctx.moveTo(outline[0]![0], outline[0]![1]);
  for (const [px, py] of outline.slice(1)) ctx.lineTo(px, py);
  ctx.closePath();
  ctx.fillStyle = "#d8a657";
  ctx.fill();
  ctx.strokeStyle = "#f4d9a8";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // Deckhouse.
  ctx.save();
  ctx.translate(sim.x, sim.y);
  ctx.rotate(sim.heading);
  ctx.fillStyle = "#8a6a37";
  ctx.fillRect(-dockShip.length * 0.32, -dockShip.beam * 0.28, dockShip.length * 0.22, dockShip.beam * 0.56);
  ctx.restore();

  ctx.restore();
}
