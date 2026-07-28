/**
 * The docking minigame — the beating heart of Ports of Call, rebuilt as a
 * small physics sim. Top-down harbour, engine telegraph and rudder, and a
 * berth to lay her alongside: inside the mark, slow, and pointing the right
 * way. Touch a wall and the yard will hear about it.
 *
 * Pure functions over a `DockSim` value; the canvas in `ui/DockingScreen.tsx`
 * is just a viewer. World units are metres, +x east, +y south (canvas-style).
 */
import type { HarborKind } from "./world";

export type Wall = readonly [number, number, number, number];

export type Harbor = {
  readonly kind: HarborKind;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly walls: readonly Wall[];
  /** Centre of the berth, its heading, and the quay length reserved. */
  readonly berth: { x: number; y: number; angle: number; length: number };
  readonly entry: { x: number; y: number; heading: number };
  /** Seconds on the hourglass. */
  readonly timeLimit: number;
};

/**
 * Three hand-laid harbours. `open` is a lee quay behind a breakwater, `river`
 * threads a channel past a jetty, `basin` turns inside a walled dock.
 */
export const HARBORS: Readonly<Record<HarborKind, Harbor>> = {
  open: {
    kind: "open",
    name: "Roadstead quay",
    width: 1200,
    height: 700,
    walls: [
      [260, 150, 950, 150], // breakwater
      [180, 560, 1130, 560], // the quay itself
      [1130, 560, 1130, 320], // eastern mole
    ],
    berth: { x: 700, y: 535, angle: 0, length: 240 },
    entry: { x: 60, y: 330, heading: 0 },
    timeLimit: 150,
  },
  river: {
    kind: "river",
    name: "River berth",
    width: 1200,
    height: 700,
    walls: [
      [0, 190, 1200, 190], // north bank
      [0, 540, 470, 540], // south bank, west reach
      [470, 540, 520, 460], // training wall
      [520, 460, 1200, 460], // south bank, east reach
      [640, 190, 640, 300], // moored dredger off the north bank
    ],
    berth: { x: 900, y: 218, angle: 0, length: 220 },
    entry: { x: 60, y: 370, heading: 0 },
    timeLimit: 165,
  },
  basin: {
    kind: "basin",
    name: "Inner basin",
    width: 1200,
    height: 700,
    walls: [
      [140, 120, 1080, 120], // north quay
      [1080, 120, 1080, 620], // east quay
      [1080, 620, 140, 620], // south quay
      [140, 620, 140, 400], // west quay, south of the gate
      [140, 260, 140, 120], // west quay, north of the gate
      [560, 120, 560, 330], // finger pier
    ],
    berth: { x: 1052, y: 380, angle: Math.PI / 2, length: 200 },
    entry: { x: 40, y: 330, heading: 0 },
    timeLimit: 180,
  },
};

// ── The ship in the harbour ──────────────────────────────────────────────────

export type DockShip = {
  /** Metres. Derived from tonnage in `dockShipFor`. */
  readonly length: number;
  readonly beam: number;
  /** 1 nimble … 3 a brick; scales response and turn rate. */
  readonly handling: 1 | 2 | 3;
};

export function dockShipFor(dwt: number, handling: 1 | 2 | 3): DockShip {
  const length = Math.round(55 + Math.cbrt(dwt) * 2.6);
  return { length, beam: Math.round(length / 6.2), handling };
}

/**
 * Engine telegraph notches: full astern … full ahead, in m/s.
 * Scaled so a straight run at full ahead can clear the farthest berth with
 * time left to slow and lay alongside — the old 3.2 m/s top end only made it
 * halfway across a 1200 m basin before the hourglass ran out.
 */
export const TELEGRAPH_SPEEDS: readonly number[] = [-6.0, -3.0, 0, 3.5, 7.5, 13.0];
export const TELEGRAPH_LABELS: readonly string[] = [
  "Full astern",
  "Slow astern",
  "Stop",
  "Dead slow",
  "Slow ahead",
  "Full ahead",
];
export const TELEGRAPH_STOP = 2; // index of "Stop"
export const TELEGRAPH_FULL_AHEAD = 5;

export type DockOutcome =
  | { kind: "docked" }
  | { kind: "crashed"; impact: number }
  | { kind: "timeout" };

export type DockSim = {
  x: number;
  y: number;
  /** Radians, 0 = east, positive clockwise (canvas y grows south). */
  heading: number;
  /** Metres per second along the heading; negative when making sternway. */
  speed: number;
  telegraph: number;
  /** -1 hard to port … +1 hard to starboard. */
  rudder: number;
  t: number;
  outcome: DockOutcome | null;
};

export function newDockSim(harbor: Harbor): DockSim {
  return {
    x: harbor.entry.x,
    y: harbor.entry.y,
    heading: harbor.entry.heading,
    speed: 6.0,
    telegraph: 4, // slow ahead through the gate
    rudder: 0,
    t: 0,
    outcome: null,
  };
}

export type DockInput = {
  telegraph: number;
  rudder: number;
};

const DOCKED_SPEED = 0.42;
const DOCKED_ANGLE = Math.PI / 9; // ±20°
const SAFE_TOUCH = 0.55; // gentler than this against the quay is seamanship

/** Bow, shoulders and quarters — enough of an outline for wall tests. */
export function shipOutline(sim: DockSim, ship: DockShip): [number, number][] {
  const cos = Math.cos(sim.heading);
  const sin = Math.sin(sim.heading);
  const l = ship.length / 2;
  const b = ship.beam / 2;
  const at = (dx: number, dy: number): [number, number] => [
    sim.x + dx * cos - dy * sin,
    sim.y + dx * sin + dy * cos,
  ];
  return [
    at(l, 0), // bow
    at(l * 0.55, -b),
    at(-l, -b),
    at(-l, b),
    at(l * 0.55, b),
  ];
}

function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) =>
    (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function touchesWalls(sim: DockSim, ship: DockShip, harbor: Harbor): boolean {
  const outline = shipOutline(sim, ship);
  for (let i = 0; i < outline.length; i += 1) {
    const [ax, ay] = outline[i]!;
    const [bx, by] = outline[(i + 1) % outline.length]!;
    for (const [cx, cy, dx, dy] of harbor.walls) {
      if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return true;
    }
  }
  return false;
}

function outsideWorld(sim: DockSim, harbor: Harbor): boolean {
  const margin = 30;
  return (
    sim.x < -margin ||
    sim.y < -margin ||
    sim.x > harbor.width + margin ||
    sim.y > harbor.height + margin
  );
}

/** Angle folded to [-π, π]. */
function fold(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function isDocked(sim: DockSim, ship: DockShip, harbor: Harbor): boolean {
  if (Math.abs(sim.speed) > DOCKED_SPEED) return false;

  const berth = harbor.berth;
  // Fast alongside means the whole ship lies in the berth's slot: near the
  // quay line, inside its length, and parallel — either way round.
  const align = Math.min(
    Math.abs(fold(sim.heading - berth.angle)),
    Math.abs(fold(sim.heading - berth.angle - Math.PI)),
  );
  if (align > DOCKED_ANGLE) return false;

  const cos = Math.cos(berth.angle);
  const sin = Math.sin(berth.angle);
  const along = (sim.x - berth.x) * cos + (sim.y - berth.y) * sin;
  const off = -(sim.x - berth.x) * sin + (sim.y - berth.y) * cos;
  return (
    Math.abs(along) <= (berth.length - ship.length) / 2 + ship.length * 0.25 &&
    Math.abs(off) <= ship.beam * 1.6
  );
}

/**
 * One tick. Telegraph pulls the speed toward its notch, the rudder only bites
 * with way on, and big ships answer everything late.
 */
export function stepDock(
  sim: DockSim,
  input: DockInput,
  ship: DockShip,
  harbor: Harbor,
  dt: number,
): DockSim {
  if (sim.outcome) return sim;

  const telegraph = Math.max(0, Math.min(TELEGRAPH_SPEEDS.length - 1, Math.round(input.telegraph)));
  const rudder = Math.max(-1, Math.min(1, input.rudder));

  const sluggish = 1 / (0.8 + ship.handling * 0.45);
  const target = TELEGRAPH_SPEEDS[telegraph]!;
  const speed = sim.speed + (target - sim.speed) * 0.14 * sluggish * dt;

  // Rudder authority grows with speed through the water and flips astern.
  const turnRate = 0.11 * sluggish;
  const heading = sim.heading + rudder * turnRate * speed * dt;

  const next: DockSim = {
    ...sim,
    telegraph,
    rudder,
    speed,
    heading,
    x: sim.x + Math.cos(heading) * speed * dt,
    y: sim.y + Math.sin(heading) * speed * dt,
    t: sim.t + dt,
  };

  if (touchesWalls(next, ship, harbor)) {
    const impact = Math.abs(next.speed);
    if (impact > SAFE_TOUCH) {
      return { ...next, outcome: { kind: "crashed", impact } };
    }
    // A gentle touch stops her dead against the fendering.
    const stopped = { ...next, speed: 0, x: sim.x, y: sim.y };
    return isDocked(stopped, ship, harbor) ? { ...stopped, outcome: { kind: "docked" } } : stopped;
  }

  if (isDocked(next, ship, harbor)) return { ...next, outcome: { kind: "docked" } };
  if (next.t >= harbor.timeLimit || outsideWorld(next, harbor)) {
    return { ...next, outcome: { kind: "timeout" } };
  }
  return next;
}

/** Condition points a crash costs, from how hard she hit. */
export function crashDamage(impact: number): number {
  return Math.min(14, Math.max(3, Math.round(impact * 4.5)));
}
