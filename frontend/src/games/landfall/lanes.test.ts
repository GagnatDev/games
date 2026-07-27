/**
 * Keeps the sea lanes at sea. Every lane is sampled against the land polygons
 * from `mapPath.ts` (the same geometry the chart renders), so a waypoint edit
 * that drags a route across a continent fails here instead of on the map.
 *
 * The 110m coastline cannot resolve fjords, estuaries or narrow straits, so
 * lanes that end at a port get a generous allowance for the final approach
 * (Hamburg is up the Elbe, Oslo up its fjord, Vancouver behind an island).
 * Waypoint-to-waypoint lanes cross open water and get almost none.
 */
import { describe, expect, it } from "vitest";
import { MAP_HEIGHT, MAP_WIDTH, WORLD_PATH } from "./mapPath";
import { SEA_LANES, isPortId } from "./world";
import { nodePosition } from "./nav";

type Pt = readonly [number, number];

function parseRings(path: string): Pt[][] {
  const rings: Pt[][] = [];
  let current: Pt[] = [];
  const re = /([MLZ])(?:(-?[\d.]+) (-?[\d.]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path))) {
    if (match[1] === "Z") {
      if (current.length > 2) rings.push(current);
      current = [];
    } else {
      current.push([Number(match[2]), Number(match[3])]);
    }
  }
  return rings;
}

function insideRing([x, y]: Pt, ring: Pt[]): boolean {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      odd = !odd;
    }
  }
  return odd;
}

function project(lat: number, lon: number): Pt {
  return [((lon + 180) / 360) * MAP_WIDTH, ((90 - lat) / 180) * MAP_HEIGHT];
}

describe("the sea lanes and the chart agree", () => {
  const rings = parseRings(WORLD_PATH);
  const boxes = rings.map((ring) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return { minX, minY, maxX, maxY };
  });

  // Even-odd across every ring so seas the coastline encloses (holes) count
  // as water.
  const onLand = (pt: Pt): boolean => {
    let hits = 0;
    for (let i = 0; i < rings.length; i++) {
      const box = boxes[i]!;
      if (
        pt[0] >= box.minX &&
        pt[0] <= box.maxX &&
        pt[1] >= box.minY &&
        pt[1] <= box.maxY &&
        insideRing(pt, rings[i]!)
      ) {
        hits++;
      }
    }
    return hits % 2 === 1;
  };

  const STEPS = 200;

  it("parses the chart into rings", () => {
    expect(rings.length).toBeGreaterThan(100);
  });

  for (const lane of SEA_LANES) {
    if (lane.canal) continue; // canals cross land by design
    it(`keeps ${lane.a} → ${lane.b} off the rocks`, () => {
      const a = nodePosition(lane.a);
      const b = nodePosition(lane.b);
      // Antimeridian lanes cross the open Pacific; the interpolation below
      // would wrongly sweep the long way around the globe.
      if (Math.abs(a.lon - b.lon) > 180) return;

      let landSamples = 0;
      for (let s = 0; s <= STEPS; s++) {
        const t = s / STEPS;
        // Skip the ends: ports sit on (often inside) the coarse coastline.
        if (t < 0.06 || t > 0.94) continue;
        const lat = a.lat + (b.lat - a.lat) * t;
        const lon = a.lon + (b.lon - a.lon) * t;
        if (onLand(project(lat, lon))) landSamples++;
      }
      const isApproach = isPortId(lane.a) || isPortId(lane.b);
      // Approaches may thread water the 110m coastline pinches shut; open-sea
      // legs must stay dry save for a stray simplification wiggle.
      expect(landSamples).toBeLessThanOrEqual(isApproach ? 115 : 15);
    });
  }
});
