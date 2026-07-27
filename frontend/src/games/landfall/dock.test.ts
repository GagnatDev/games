import { describe, expect, it } from "vitest";
import {
  HARBORS,
  TELEGRAPH_STOP,
  crashDamage,
  dockShipFor,
  isDocked,
  newDockSim,
  shipOutline,
  stepDock,
  type DockSim,
} from "./dock";

const harbor = HARBORS.open;
const ship = dockShipFor(8500, 2);

function run(sim: DockSim, telegraph: number, rudder: number, seconds: number): DockSim {
  let current = sim;
  for (let t = 0; t < seconds * 10 && !current.outcome; t += 1) {
    current = stepDock(current, { telegraph, rudder }, ship, harbor, 0.1);
  }
  return current;
}

describe("ship handling", () => {
  it("coasts to a stop on a stopped telegraph", () => {
    const drifting = run(newDockSim(harbor), TELEGRAPH_STOP, 0, 60);
    expect(Math.abs(drifting.speed)).toBeLessThan(0.1);
    expect(drifting.x).toBeGreaterThan(newDockSim(harbor).x); // way carried her on
  });

  it("turns with the rudder only when there is way on", () => {
    const stopped: DockSim = { ...newDockSim(harbor), speed: 0, telegraph: TELEGRAPH_STOP };
    const after = stepDock(stopped, { telegraph: TELEGRAPH_STOP, rudder: 1 }, ship, harbor, 0.1);
    expect(after.heading).toBeCloseTo(stopped.heading, 5);

    const underway = run(newDockSim(harbor), 5, 1, 10);
    expect(underway.heading).toBeGreaterThan(0);
  });

  it("answers astern", () => {
    const backing = run({ ...newDockSim(harbor), speed: 0 }, 0, 0, 30);
    expect(backing.speed).toBeLessThan(0);
  });
});

describe("outcomes", () => {
  it("crashes when driven hard at the quay", () => {
    const charging: DockSim = {
      ...newDockSim(harbor),
      x: 700,
      y: 450,
      heading: Math.PI / 2, // due south, straight at the quay
      speed: 3,
    };
    const wreck = run(charging, 5, 0, 60);
    expect(wreck.outcome?.kind).toBe("crashed");
    if (wreck.outcome?.kind === "crashed") {
      expect(crashDamage(wreck.outcome.impact)).toBeGreaterThanOrEqual(3);
    }
  });

  it("docks when laid slow and parallel inside the berth", () => {
    const alongside: DockSim = {
      ...newDockSim(harbor),
      x: harbor.berth.x,
      y: harbor.berth.y - 8,
      heading: 0,
      speed: 0.2,
      telegraph: TELEGRAPH_STOP,
    };
    expect(isDocked(alongside, ship, harbor)).toBe(true);
    const berthed = stepDock(alongside, { telegraph: TELEGRAPH_STOP, rudder: 0 }, ship, harbor, 0.1);
    expect(berthed.outcome?.kind).toBe("docked");
  });

  it("refuses the berth at speed or badly angled", () => {
    const tooFast: DockSim = {
      ...newDockSim(harbor),
      x: harbor.berth.x,
      y: harbor.berth.y - 8,
      heading: 0,
      speed: 2,
    };
    expect(isDocked(tooFast, ship, harbor)).toBe(false);

    const crooked: DockSim = { ...tooFast, speed: 0.1, heading: Math.PI / 3 };
    expect(isDocked(crooked, ship, harbor)).toBe(false);
  });

  it("accepts her stern-first", () => {
    const backedIn: DockSim = {
      ...newDockSim(harbor),
      x: harbor.berth.x,
      y: harbor.berth.y - 8,
      heading: Math.PI, // facing back out the way she came
      speed: -0.1,
    };
    expect(isDocked(backedIn, ship, harbor)).toBe(true);
  });

  it("times out when the hourglass runs dry", () => {
    const idling: DockSim = { ...newDockSim(harbor), speed: 0 };
    const late = run(idling, TELEGRAPH_STOP, 0, harbor.timeLimit + 10);
    expect(late.outcome?.kind).toBe("timeout");
  });
});

describe("geometry", () => {
  it("draws a five-point hull around the centre", () => {
    const outline = shipOutline(newDockSim(harbor), ship);
    expect(outline).toHaveLength(5);
    const [bow] = outline;
    expect(bow![0]).toBeCloseTo(newDockSim(harbor).x + ship.length / 2, 3);
  });

  it("keeps every harbour's berth clear of its walls", () => {
    for (const layout of Object.values(HARBORS)) {
      const parked: DockSim = {
        ...newDockSim(layout),
        x: layout.berth.x,
        y: layout.berth.y,
        heading: layout.berth.angle,
        speed: 0,
      };
      // A ship sitting in the berth must not be touching a wall.
      const step = stepDock(parked, { telegraph: TELEGRAPH_STOP, rudder: 0 }, ship, layout, 0.1);
      expect(step.outcome?.kind).toBe("docked");
    }
  });
});
