import { describe, expect, it } from "vitest";
import { isPortId, port, shipModel } from "./world";
import {
  charterRate,
  foundingOffers,
  freightMarket,
  maxLoan,
  netWorth,
  passDay,
  refuel,
  repairCostPerPoint,
  repayLoan,
  sellShip,
  setChartered,
  shipValue,
  shipyard,
  takeLoan,
  yardJob,
} from "./economy";
import { newGameState, type LandfallState } from "./state";

function company(overrides: Partial<LandfallState> = {}): LandfallState {
  const state = newGameState({
    company: "Meridian Lines",
    homePort: "rotterdam",
    seed: 12345,
    cash: 1_000_000,
    ship: {
      id: "s1",
      name: "Kestrel",
      model: "tramp",
      condition: 70,
      fuel: 100,
    },
  });
  return { ...state, ...overrides };
}

describe("the freight market", () => {
  it("shows every device the same board", () => {
    const state = company();
    expect(freightMarket(state, "rotterdam")).toEqual(freightMarket(state, "rotterdam"));
  });

  it("rolls new cargo with the day, and differs between ports", () => {
    const state = company();
    const today = freightMarket(state, "rotterdam");
    const tomorrow = freightMarket({ ...state, day: 2 }, "rotterdam");
    expect(today).not.toEqual(tomorrow);
    expect(today).not.toEqual(freightMarket(state, "singapore"));
  });

  it("offers coherent contracts", () => {
    const state = company();
    for (const portId of ["rotterdam", "singapore", "valparaiso"]) {
      for (const contract of freightMarket(state, portId)) {
        expect(contract.from).toBe(portId);
        expect(contract.to).not.toBe(portId);
        expect(isPortId(contract.to)).toBe(true);
        expect(contract.tons).toBeGreaterThan(0);
        expect(contract.payment).toBe(Math.round(contract.ratePerTon * contract.tons));
        if (contract.deadlineDay !== null) {
          expect(contract.deadlineDay).toBeGreaterThan(state.day);
        }
      }
    }
  });

  it("has at least one lot a small port can stage", () => {
    const state = company();
    const board = freightMarket(state, "oslo");
    expect(board.length).toBeGreaterThanOrEqual(4);
    expect(board.some((c) => c.tons <= 8500)).toBe(true);
  });
});

describe("the shipyard", () => {
  it("runs only in ports of size 2 and up, on a weekly board", () => {
    const state = company();
    expect(shipyard(state, "oslo")).toHaveLength(0);
    const thisWeek = shipyard(state, "rotterdam");
    expect(thisWeek.length).toBeGreaterThan(0);
    // Same week, same hulls; next week, a new board.
    expect(shipyard({ ...state, day: 3 }, "rotterdam")).toEqual(thisWeek);
    expect(shipyard({ ...state, day: 8 }, "rotterdam")).not.toEqual(thisWeek);
  });

  it("prices hulls off their condition", () => {
    for (const offer of shipyard(company(), "singapore")) {
      const value = shipValue(offer.model, offer.condition);
      expect(offer.price).toBeGreaterThan(value * 0.9 - 1);
      expect(offer.price).toBeLessThan(value * 1.16);
    }
  });
});

describe("founding offers", () => {
  it("stay affordable and deterministic", () => {
    const offers = foundingOffers(42, 2_500_000);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers).toEqual(foundingOffers(42, 2_500_000));
    for (const offer of offers) {
      expect(offer.price).toBeLessThan(2_500_000);
    }
  });
});

describe("port business", () => {
  it("refuels no further than the tank", () => {
    const state = company();
    const model = shipModel("tramp");
    const filled = refuel(state, "s1", 10_000);
    expect(filled.ships[0]!.fuel).toBe(model.fuelTank);
    const price = port("rotterdam").fuelPrice;
    expect(filled.cash).toBe(state.cash - (model.fuelTank - 100) * price);
  });

  it("quotes yard work at a day per 12 points started", () => {
    const state = company();
    const job = yardJob(state, "s1", 24)!;
    expect(job.points).toBe(24);
    expect(job.days).toBe(2);
    expect(job.cost).toBe(24 * repairCostPerPoint(shipModel("tramp")));
  });

  it("caps the quote at the points actually missing", () => {
    const state = company({ ships: [{ ...company().ships[0]!, condition: 95 }] });
    const job = yardJob(state, "s1", 40)!;
    expect(job.points).toBe(5);
    expect(job.days).toBe(1);
  });

  it("has nothing to quote for a sound ship, an unknown ship or one at sea", () => {
    const sound = company({ ships: [{ ...company().ships[0]!, condition: 100 }] });
    expect(yardJob(sound, "s1", 10)).toBeNull();
    expect(yardJob(company(), "nobody", 10)).toBeNull();
    const atSea = company({ ships: [{ ...company().ships[0]!, port: null }] });
    expect(yardJob(atSea, "s1", 10)).toBeNull();
  });

  it("sells at value less the broker's cut", () => {
    const state = company();
    const sold = sellShip(state, "s1");
    expect(sold.ships).toHaveLength(0);
    expect(sold.activeShipId).toBeNull();
    const value = shipValue(shipModel("tramp"), 70);
    expect(sold.cash).toBe(state.cash + Math.round(value * 0.92));
  });

  it("caps a loan at the fleet's collateral and repays out of cash", () => {
    const state = company();
    const ceiling = maxLoan(state);
    const borrowed = takeLoan(state, 99_000_000);
    expect(borrowed.loan).toBe(ceiling);
    expect(borrowed.cash).toBe(state.cash + ceiling);

    const repaid = repayLoan(borrowed, 99_000_000);
    expect(repaid.loan).toBe(Math.max(0, ceiling - borrowed.cash));
  });
});

describe("the daily ledger", () => {
  it("charges wages and dues for an idle ship", () => {
    const state = company();
    const next = passDay(state);
    expect(next.day).toBe(2);
    const model = shipModel("tramp");
    const dues = port("rotterdam").size * 140;
    expect(next.cash).toBe(state.cash - model.crewPerDay - dues);
  });

  it("pays charter hire instead of costing wages", () => {
    const state = setChartered(company(), "s1", true);
    const next = passDay(state);
    expect(next.cash).toBe(state.cash + charterRate(state.ships[0]!));
  });

  it("collects interest on the loan", () => {
    const state = takeLoan(company(), 500_000);
    const next = passDay(state);
    const model = shipModel("tramp");
    const dues = port("rotterdam").size * 140;
    expect(next.cash).toBe(
      state.cash - model.crewPerDay - dues - Math.round(500_000 * 0.0006),
    );
  });
});

describe("net worth", () => {
  it("is cash plus fleet less debt", () => {
    const state = company();
    const expected = Math.round(
      state.cash - state.loan + shipValue(shipModel("tramp"), 70),
    );
    expect(netWorth(state)).toBe(expected);
  });
});
