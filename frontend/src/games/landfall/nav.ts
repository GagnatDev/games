/**
 * Sea navigation: great-circle distances over the hand-laid lane graph in
 * `world.ts`, shortest routes between ports, and canal alternatives.
 *
 * Routing is Dijkstra over lane length. When the best route uses a canal the
 * planner also computes the best canal-free route, so the player gets the
 * classic choice: pay the toll or sail around the Cape.
 */
import { PORTS, SEA_LANES, WAYPOINTS, type SeaLane } from "./world";

export type NodeId = string;

type NodePos = { readonly lat: number; readonly lon: number };

const nodes = new Map<NodeId, NodePos>([
  ...PORTS.map((p) => [p.id, { lat: p.lat, lon: p.lon }] as const),
  ...WAYPOINTS.map((w) => [w.id, { lat: w.lat, lon: w.lon }] as const),
]);

export function nodePosition(id: NodeId): NodePos {
  const found = nodes.get(id);
  if (!found) throw new Error(`unknown sea node: ${id}`);
  return found;
}

const EARTH_RADIUS_NM = 3440.065;

/** Great-circle distance in nautical miles. Handles the antimeridian. */
export function greatCircleNm(a: NodePos, b: NodePos): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Adjacency = Map<NodeId, { to: NodeId; nm: number; lane: SeaLane }[]>;

function buildAdjacency(lanes: readonly SeaLane[]): Adjacency {
  const adjacency: Adjacency = new Map();
  for (const lane of lanes) {
    const nm = greatCircleNm(nodePosition(lane.a), nodePosition(lane.b));
    for (const [from, to] of [
      [lane.a, lane.b],
      [lane.b, lane.a],
    ] as const) {
      const list = adjacency.get(from) ?? [];
      list.push({ to, nm, lane });
      adjacency.set(from, list);
    }
  }
  return adjacency;
}

const fullGraph = buildAdjacency(SEA_LANES);
const canalFreeGraph = buildAdjacency(SEA_LANES.filter((lane) => !lane.canal));

export type Route = {
  /** Node ids from origin port to destination port, waypoints included. */
  readonly legs: readonly NodeId[];
  readonly distanceNm: number;
  readonly canals: readonly ("suez" | "panama")[];
  /** Highest piracy weight of any lane on the way, 0 when the way is clear. */
  readonly piracy: number;
};

function dijkstra(graph: Adjacency, from: NodeId, to: NodeId): Route | null {
  const dist = new Map<NodeId, number>([[from, 0]]);
  const previous = new Map<NodeId, NodeId>();
  const done = new Set<NodeId>();
  // The graph has ~80 nodes; a scan beats a heap at this size.
  const open = new Set<NodeId>([from]);

  while (open.size > 0) {
    let current: NodeId | null = null;
    let best = Infinity;
    for (const id of open) {
      const d = dist.get(id) ?? Infinity;
      if (d < best) {
        best = d;
        current = id;
      }
    }
    if (current === null) break;
    open.delete(current);
    if (current === to) break;
    done.add(current);

    for (const edge of graph.get(current) ?? []) {
      if (done.has(edge.to)) continue;
      const candidate = best + edge.nm;
      if (candidate < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, candidate);
        previous.set(edge.to, current);
        open.add(edge.to);
      }
    }
  }

  if (!dist.has(to)) return null;

  const legs: NodeId[] = [to];
  while (legs[0] !== from) {
    const prev = previous.get(legs[0]!);
    if (!prev) return null;
    legs.unshift(prev);
  }

  const canals: ("suez" | "panama")[] = [];
  let piracy = 0;
  for (let i = 0; i < legs.length - 1; i += 1) {
    const edge = (graph.get(legs[i]!) ?? []).find((e) => e.to === legs[i + 1]);
    if (edge?.lane.canal) canals.push(edge.lane.canal);
    piracy = Math.max(piracy, edge?.lane.piracy ?? 0);
  }

  return { legs, distanceNm: Math.round(dist.get(to)!), canals, piracy };
}

/** The shortest route, canals allowed. Every port pair has one (tested). */
export function shortestRoute(from: NodeId, to: NodeId): Route | null {
  return dijkstra(fullGraph, from, to);
}

/**
 * The toll-free alternative — only interesting when the shortest route uses a
 * canal and a different way exists. Returns null when they are the same route.
 */
export function canalFreeRoute(from: NodeId, to: NodeId): Route | null {
  const best = shortestRoute(from, to);
  if (!best || best.canals.length === 0) return null;
  const around = dijkstra(canalFreeGraph, from, to);
  return around && around.distanceNm > best.distanceNm ? around : null;
}

/**
 * Where along a route a ship is after covering `coveredNm` — for the chart
 * marker. Returns lat/lon interpolated linearly within the current leg.
 */
export function positionAlong(route: Route, coveredNm: number): NodePos {
  // `distanceNm` is rounded, so "arrived" must clamp to the destination.
  if (coveredNm >= route.distanceNm) {
    return nodePosition(route.legs[route.legs.length - 1]!);
  }
  let remaining = Math.max(0, coveredNm);
  for (let i = 0; i < route.legs.length - 1; i += 1) {
    const a = nodePosition(route.legs[i]!);
    const b = nodePosition(route.legs[i + 1]!);
    const legNm = greatCircleNm(a, b);
    if (remaining <= legNm && legNm > 0) {
      const t = remaining / legNm;
      // Interpolate longitudes the short way round the antimeridian.
      let dLon = b.lon - a.lon;
      if (dLon > 180) dLon -= 360;
      if (dLon < -180) dLon += 360;
      let lon = a.lon + dLon * t;
      if (lon > 180) lon -= 360;
      if (lon < -180) lon += 360;
      return { lat: a.lat + (b.lat - a.lat) * t, lon };
    }
    remaining -= legNm;
  }
  return nodePosition(route.legs[route.legs.length - 1]!);
}
