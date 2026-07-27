// One-off generator for `src/games/landfall/mapPath.ts`.
//
// Downloads Natural Earth's 110m land layer (public domain, via the world-atlas
// npm package on jsdelivr), decodes the TopoJSON by hand and projects it with a
// plain equirectangular projection into a 1000x500 viewBox — the same linear
// lon/lat mapping the game uses for ports, so everything lands on the same
// coordinate system without a projection library in the bundle.
//
// Run it only when the map needs regenerating:
//   node scripts/generate-landfall-map.mjs
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json";
const WIDTH = 1000;
const HEIGHT = 500;

const topology = await (await fetch(SOURCE)).json();

const { scale, translate } = topology.transform;

/** Decode one delta-encoded arc into absolute [lon, lat] pairs. */
function decodeArc(arc) {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
  });
}

const arcs = topology.arcs.map(decodeArc);

/** Stitch arc indices (negative = reversed, bitwise-not) into one ring. */
function ring(arcIndexes) {
  const points = [];
  for (const index of arcIndexes) {
    const arc = index >= 0 ? arcs[index] : [...arcs[~index]].reverse();
    // Consecutive arcs share their join point; keep it once.
    points.push(...(points.length ? arc.slice(1) : arc));
  }
  return points;
}

function project([lon, lat]) {
  return [
    ((lon + 180) / 360) * WIDTH,
    ((90 - lat) / 180) * HEIGHT,
  ];
}

// --- Antimeridian handling -------------------------------------------------
// A few rings (Afro-Eurasia via Chukotka, Fiji, Wrangel Island, Antarctica)
// cross ±180°. Projected naively they gain a full-width horizontal edge that
// both draws a hairline across the map and breaks any point-in-polygon test.
// Unwrap each ring into continuous longitudes, close polar rings over the
// pole, then clip shifted copies to the [-180, 180] window.

/** Make longitudes continuous: never jump more than 180° between vertices. */
function unwrap(points) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    let [lon, lat] = points[i];
    const prev = out[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, lat]);
  }
  return out;
}

function lerpAtLon(a, b, lon) {
  const t = (lon - a[0]) / (b[0] - a[0]);
  return [lon, a[1] + (b[1] - a[1]) * t];
}

/** Sutherland–Hodgman clip of a ring to minLon <= lon <= maxLon. */
function clipLon(points, minLon, maxLon) {
  const clipEdge = (pts, keep, boundary) => {
    const res = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i + pts.length - 1) % pts.length];
      const cur = pts[i];
      if (keep(cur)) {
        if (!keep(prev)) res.push(lerpAtLon(prev, cur, boundary));
        res.push(cur);
      } else if (keep(prev)) {
        res.push(lerpAtLon(prev, cur, boundary));
      }
    }
    return res;
  };
  let pts = clipEdge(points, (p) => p[0] >= minLon, minLon);
  if (pts.length) pts = clipEdge(pts, (p) => p[0] <= maxLon, maxLon);
  return pts;
}

/** Cut one lon/lat ring into ring pieces that all live inside [-180, 180]. */
function cutRing(rawRing) {
  // TopoJSON rings repeat the first vertex at the end. Unwrap with the
  // closing vertex in place: if the ring winds around a pole, the unwrapped
  // closing vertex ends up a full 360° away from the start.
  const u = unwrap(rawRing);
  const winds = Math.abs(u.at(-1)[0] - u[0][0]) > 180;
  let pts;
  if (winds) {
    // Close the polar ring along the pole edge so it becomes a plain polygon.
    const meanLat = u.reduce((s, p) => s + p[1], 0) / u.length;
    const poleLat = meanLat < 0 ? -90 : 90;
    pts = [...u, [u.at(-1)[0], poleLat], [u[0][0], poleLat]];
  } else {
    pts = u.slice(0, -1); // drop the closing vertex; rings close implicitly
  }

  const lons = pts.map((p) => p[0]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const pieces = [];
  const kMin = Math.ceil((-180 - maxLon) / 360);
  const kMax = Math.floor((180 - minLon) / 360);
  for (let k = kMin; k <= kMax; k++) {
    const shifted = pts.map(([lon, lat]) => [lon + k * 360, lat]);
    const clipped = clipLon(shifted, -180, 180);
    if (clipped.length >= 3 && Math.abs(shoelace(clipped)) > 1e-6) pieces.push(clipped);
  }
  return pieces;
}

function shoelace(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

// objects.land is a GeometryCollection holding a single MultiPolygon.
const polygons = topology.objects.land.geometries.flatMap((geometry) =>
  geometry.type === "MultiPolygon" ? geometry.arcs : [geometry.arcs],
);

let path = "";
for (const polygon of polygons) {
  for (const rawRing of polygon) {
    for (const piece of cutRing(ring(rawRing))) {
      const points = piece.map(project);
      path += points
        .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
        .join("");
      path += "Z";
    }
  }
}

const out = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "games",
  "landfall",
  "mapPath.ts",
);

await writeFile(
  out,
  `// Generated by scripts/generate-landfall-map.mjs — do not edit by hand.
// Natural Earth 110m land (public domain), equirectangular, viewBox 0 0 ${WIDTH} ${HEIGHT}.

export const MAP_WIDTH = ${WIDTH};
export const MAP_HEIGHT = ${HEIGHT};

export const WORLD_PATH =
  "${path}";
`,
);

console.log(`wrote ${out} (${path.length} path chars)`);
