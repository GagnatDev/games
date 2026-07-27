import { describe, expect, it } from "vitest";
import { PORTS } from "./world";
import {
  canalFreeRoute,
  greatCircleNm,
  nodePosition,
  positionAlong,
  shortestRoute,
} from "./nav";

describe("the sea-lane graph", () => {
  it("connects every pair of ports", () => {
    for (const from of PORTS) {
      for (const to of PORTS) {
        if (from.id === to.id) continue;
        const route = shortestRoute(from.id, to.id);
        expect(route, `${from.id} → ${to.id}`).not.toBeNull();
        expect(route!.distanceNm).toBeGreaterThan(0);
      }
    }
  });

  it("never beats the great circle", () => {
    for (const from of PORTS) {
      for (const to of PORTS) {
        if (from.id === to.id) continue;
        const direct = greatCircleNm(from, to);
        const route = shortestRoute(from.id, to.id)!;
        // Rounding gives the route a ±1nm grace.
        expect(route.distanceNm + 1, `${from.id} → ${to.id}`).toBeGreaterThanOrEqual(
          Math.floor(direct),
        );
      }
    }
  });

  it("is symmetric", () => {
    const there = shortestRoute("oslo", "yokohama")!;
    const back = shortestRoute("yokohama", "oslo")!;
    expect(there.distanceNm).toBe(back.distanceNm);
    expect([...back.legs].reverse()).toEqual([...there.legs]);
  });
});

describe("canals", () => {
  it("routes Rotterdam–Dubai through Suez, with a Cape alternative", () => {
    const best = shortestRoute("rotterdam", "dubai")!;
    expect(best.canals).toContain("suez");

    const around = canalFreeRoute("rotterdam", "dubai")!;
    expect(around).not.toBeNull();
    expect(around.canals).toHaveLength(0);
    expect(around.distanceNm).toBeGreaterThan(best.distanceNm);
  });

  it("routes New York–Los Angeles through Panama, with a Horn alternative", () => {
    const best = shortestRoute("new-york", "los-angeles")!;
    expect(best.canals).toContain("panama");

    const around = canalFreeRoute("new-york", "los-angeles")!;
    expect(around.legs).toContain("w-cape-horn");
  });

  it("offers no alternative when the best route needs no canal", () => {
    expect(canalFreeRoute("oslo", "rotterdam")).toBeNull();
  });
});

describe("piracy", () => {
  it("flags the Gulf of Aden on a Suez passage", () => {
    const route = shortestRoute("rotterdam", "mumbai")!;
    expect(route.piracy).toBeGreaterThan(0);
  });

  it("keeps the North Atlantic clear", () => {
    const route = shortestRoute("rotterdam", "new-york")!;
    expect(route.piracy).toBe(0);
  });
});

describe("positionAlong", () => {
  it("starts at the origin and ends at the destination", () => {
    const route = shortestRoute("oslo", "new-york")!;
    expect(positionAlong(route, 0)).toEqual(nodePosition("oslo"));
    expect(positionAlong(route, route.distanceNm)).toEqual(nodePosition("new-york"));
  });

  it("interpolates the short way across the antimeridian", () => {
    const route = shortestRoute("yokohama", "vancouver")!;
    const halfway = positionAlong(route, route.distanceNm / 2);
    // Mid-Pacific: either far east or far west, never near Greenwich.
    expect(Math.abs(halfway.lon)).toBeGreaterThan(140);
  });
});
