import { Fragment, useId, type ReactNode } from "react";
import { MAP_HEIGHT, MAP_WIDTH, WORLD_PATH } from "../mapPath";
import { nodePosition } from "../nav";
import { PORTS, port } from "../world";

/**
 * The chart — a dark nautical map of the whole trading world, projected with
 * the same plain equirectangular mapping the land path was generated with.
 * Everything drawn on it (ports, routes, the ship) is lat/lon through
 * `project`, so it all stays in register.
 */

/** Crop the poles: lat 84°N … −58°S is where the game happens. */
const VIEW_TOP = ((90 - 84) / 180) * MAP_HEIGHT;
const VIEW_BOTTOM = ((90 + 58) / 180) * MAP_HEIGHT;

export function project(lat: number, lon: number): [number, number] {
  return [((lon + 180) / 360) * MAP_WIDTH, ((90 - lat) / 180) * MAP_HEIGHT];
}

type LatLon = { lat: number; lon: number };

/**
 * Split a run of nodes into drawable strands, cutting each leg that crosses
 * the antimeridian at the edge so the Pacific is sailed, not the whole map.
 */
export function routeStrands(points: readonly LatLon[]): [number, number][][] {
  const strands: [number, number][][] = [];
  let current: [number, number][] = [];

  for (let i = 0; i < points.length; i += 1) {
    const here = points[i]!;
    if (i === 0) {
      current.push(project(here.lat, here.lon));
      continue;
    }
    const prev = points[i - 1]!;
    const dLon = here.lon - prev.lon;

    if (Math.abs(dLon) > 180) {
      // Crossing: interpolate the latitude at the edge, break the strand.
      const wrapped = dLon > 0 ? dLon - 360 : dLon + 360;
      const eastward = wrapped > 0;
      const edge = eastward
        ? prev.lon > 0 ? 180 : -180
        : prev.lon > 0 ? 180 : -180;
      const span = Math.abs(wrapped);
      const t = span === 0 ? 0 : Math.abs(edge - prev.lon) / span;
      const latAtEdge = prev.lat + (here.lat - prev.lat) * t;
      current.push(project(latAtEdge, edge));
      strands.push(current);
      current = [project(latAtEdge, -edge)];
    }
    current.push(project(here.lat, here.lon));
  }
  if (current.length > 1) strands.push(current);
  return strands;
}

function strandsPath(strands: [number, number][][]): string {
  return strands
    .map(
      (strand) =>
        "M" +
        strand.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L"),
    )
    .join("");
}

export type MapRoute = {
  /** Node ids, origin → destination. */
  legs: readonly string[];
  /** 0…1 of the way sailed; renders the covered part solid. */
  progress?: number;
};

export type WorldMapProps = {
  /** Port to mark as "you are here". */
  here?: string | null;
  /** Port to mark as the destination. */
  destination?: string | null;
  route?: MapRoute | null;
  /** The ship under way, drawn as a vessel marker. */
  ship?: LatLon | null;
  onSelectPort?: (id: string) => void;
  /** Ports to render highlighted as selectable (setup screen). */
  selectable?: boolean;
  children?: ReactNode;
};

export function WorldMap({
  here = null,
  destination = null,
  route = null,
  ship = null,
  onSelectPort,
  selectable = false,
  children,
}: WorldMapProps) {
  const uid = useId();
  const routePoints = route ? route.legs.map((id) => nodePosition(id)) : null;
  const strands = routePoints ? routeStrands(routePoints) : null;

  // The covered part of the route, cut at `progress` along total length.
  let coveredPath: string | null = null;
  if (strands && route?.progress !== undefined) {
    let total = 0;
    const lengths: number[] = [];
    for (const strand of strands) {
      for (let i = 1; i < strand.length; i += 1) {
        const [ax, ay] = strand[i - 1]!;
        const [bx, by] = strand[i]!;
        const l = Math.hypot(bx - ax, by - ay);
        lengths.push(l);
        total += l;
      }
    }
    let budget = total * Math.max(0, Math.min(1, route.progress));
    const covered: [number, number][][] = [];
    let k = 0;
    for (const strand of strands) {
      const piece: [number, number][] = [strand[0]!];
      for (let i = 1; i < strand.length; i += 1) {
        const l = lengths[k]!;
        k += 1;
        if (budget <= 0) break;
        const [ax, ay] = strand[i - 1]!;
        const [bx, by] = strand[i]!;
        if (budget >= l) {
          piece.push(strand[i]!);
          budget -= l;
        } else {
          const t = budget / l;
          piece.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
          budget = 0;
        }
      }
      if (piece.length > 1) covered.push(piece);
      if (budget <= 0) break;
    }
    coveredPath = strandsPath(covered);
  }

  return (
    <div className="lf-map">
      <svg
        viewBox={`0 ${VIEW_TOP.toFixed(1)} ${MAP_WIDTH} ${(VIEW_BOTTOM - VIEW_TOP).toFixed(1)}`}
        role="img"
        aria-label="Chart of the trading world"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id={`${uid}-sea`} cx="50%" cy="18%" r="95%">
            <stop offset="0%" stopColor="#0f2233" />
            <stop offset="55%" stopColor="#0a1826" />
            <stop offset="100%" stopColor="#071019" />
          </radialGradient>
          <filter id={`${uid}-glow`} x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect
          x="0"
          y={VIEW_TOP}
          width={MAP_WIDTH}
          height={VIEW_BOTTOM - VIEW_TOP}
          fill={`url(#${uid}-sea)`}
        />

        {/* Graticule — the chart-room feel. */}
        <g className="lf-map__grid" aria-hidden="true">
          {Array.from({ length: 11 }, (_, i) => (i + 1) * 30).map((lonLine) => (
            <line
              key={`lon-${lonLine}`}
              x1={(lonLine / 360) * MAP_WIDTH}
              y1={VIEW_TOP}
              x2={(lonLine / 360) * MAP_WIDTH}
              y2={VIEW_BOTTOM}
            />
          ))}
          {[-30, 0, 30, 60].map((latLine) => (
            <line
              key={`lat-${latLine}`}
              x1={0}
              y1={((90 - latLine) / 180) * MAP_HEIGHT}
              x2={MAP_WIDTH}
              y2={((90 - latLine) / 180) * MAP_HEIGHT}
            />
          ))}
          {/* The equator gets a hair more presence. */}
          <line
            className="lf-map__equator"
            x1={0}
            y1={MAP_HEIGHT / 2}
            x2={MAP_WIDTH}
            y2={MAP_HEIGHT / 2}
          />
        </g>

        <path className="lf-map__land" d={WORLD_PATH} />

        {/* The route: full track dashed, covered part solid. */}
        {strands && (
          <g filter={`url(#${uid}-glow)`}>
            <path className="lf-map__route" d={strandsPath(strands)} />
            {coveredPath && <path className="lf-map__route-done" d={coveredPath} />}
          </g>
        )}

        {/* Ports. */}
        {PORTS.map((p) => {
          const [x, y] = project(p.lat, p.lon);
          const role =
            p.id === here ? "here" : p.id === destination ? "destination" : "other";
          const marker = (
            <Fragment key={p.id}>
              <circle
                className={`lf-map__port lf-map__port--${role}${selectable ? " lf-map__port--pick" : ""}`}
                cx={x}
                cy={y}
                r={role === "other" ? 3 : 4.5}
                filter={role !== "other" ? `url(#${uid}-glow)` : undefined}
              />
              {role !== "other" && (
                <text className="lf-map__label" x={x + 7} y={y + 3.5}>
                  {p.name}
                </text>
              )}
            </Fragment>
          );
          if (!onSelectPort) return marker;
          return (
            <g
              key={p.id}
              role="button"
              tabIndex={0}
              aria-label={`${p.name}, ${p.country}`}
              className="lf-map__hit"
              onClick={() => onSelectPort(p.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectPort(p.id);
                }
              }}
            >
              <circle cx={x} cy={y} r={12} fill="transparent" />
              {marker}
              <title>{`${p.name} — ${p.country}`}</title>
            </g>
          );
        })}

        {/* The ship under way. */}
        {ship && <ShipMarker at={ship} glow={`url(#${uid}-glow)`} />}

        {children}
      </svg>
    </div>
  );
}

function ShipMarker({ at, glow }: { at: LatLon; glow: string }) {
  const [x, y] = project(at.lat, at.lon);
  return (
    <g className="lf-map__ship" transform={`translate(${x} ${y})`} filter={glow}>
      <circle className="lf-map__ship-ring" r="7" />
      <path d="M0 -4.6 L3.4 3.8 L0 2 L-3.4 3.8 Z" />
    </g>
  );
}

/** Convenience: mark a port name for labels outside the SVG. */
export function portName(id: string): string {
  return port(id).name;
}
