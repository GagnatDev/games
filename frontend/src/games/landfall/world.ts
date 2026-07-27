/**
 * The world Landfall trades in: cargo, ports, ship classes and the sea lanes
 * between them. Pure data — the routing lives in `nav.ts`, the economy in
 * `economy.ts`. All of it ships inside the game's own chunk; the platform
 * never learns what a ship or a port is.
 *
 * Coordinates are plain lat/lon; the map projects them linearly onto the same
 * equirectangular canvas as `mapPath.ts`.
 */

// ── Cargo ────────────────────────────────────────────────────────────────────

/** What kind of hold a lot needs. Ship models declare what they can carry. */
export type CargoKind = "dry" | "container" | "liquid";

export type Cargo = {
  readonly id: string;
  readonly name: string;
  readonly kind: CargoKind;
  /** Dollars per ton per 1,000 nautical miles, before market swing. */
  readonly rate: number;
  /** Perishable lots always carry a deadline and pay a premium. */
  readonly perishable?: boolean;
};

export const CARGOES: readonly Cargo[] = [
  { id: "grain", name: "Grain", kind: "dry", rate: 5.4 },
  { id: "coal", name: "Coal", kind: "dry", rate: 4.3 },
  { id: "iron-ore", name: "Iron ore", kind: "dry", rate: 4.1 },
  { id: "timber", name: "Timber", kind: "dry", rate: 5.0 },
  { id: "cement", name: "Cement", kind: "dry", rate: 4.2 },
  { id: "coffee", name: "Coffee", kind: "dry", rate: 7.0 },
  { id: "fruit", name: "Fruit", kind: "dry", rate: 8.8, perishable: true },
  { id: "containers", name: "Containers", kind: "container", rate: 6.6 },
  { id: "machinery", name: "Machinery", kind: "container", rate: 7.9 },
  { id: "automobiles", name: "Automobiles", kind: "container", rate: 7.5 },
  { id: "electronics", name: "Electronics", kind: "container", rate: 9.2 },
  { id: "textiles", name: "Textiles", kind: "container", rate: 6.0 },
  { id: "crude-oil", name: "Crude oil", kind: "liquid", rate: 5.8 },
  { id: "chemicals", name: "Chemicals", kind: "liquid", rate: 7.4 },
];

const cargoById = new Map(CARGOES.map((cargo) => [cargo.id, cargo]));

export function cargo(id: string): Cargo {
  const found = cargoById.get(id);
  if (!found) throw new Error(`unknown cargo: ${id}`);
  return found;
}

// ── Ports ────────────────────────────────────────────────────────────────────

/** Which docking layout the harbour uses (see `dock.ts`). */
export type HarborKind = "open" | "river" | "basin";

export type Port = {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly lat: number;
  readonly lon: number;
  /** 1 = minor, 3 = major hub. Drives market depth, fees and the shipyard. */
  readonly size: 1 | 2 | 3;
  /** Cargo this port exports, with weights for the market generator. */
  readonly exports: Readonly<Record<string, number>>;
  /** Bunker fuel, dollars per ton. */
  readonly fuelPrice: number;
  readonly harbor: HarborKind;
};

export const PORTS: readonly Port[] = [
  { id: "oslo", name: "Oslo", country: "Norway", lat: 59.9, lon: 10.7, size: 1, harbor: "basin", fuelPrice: 470, exports: { timber: 4, machinery: 2, chemicals: 2, fruit: 0 } },
  { id: "hamburg", name: "Hamburg", country: "Germany", lat: 53.55, lon: 9.95, size: 3, harbor: "river", fuelPrice: 450, exports: { machinery: 4, automobiles: 3, containers: 4, chemicals: 2 } },
  { id: "rotterdam", name: "Rotterdam", country: "Netherlands", lat: 51.95, lon: 4.1, size: 3, harbor: "river", fuelPrice: 440, exports: { containers: 5, chemicals: 3, machinery: 3, grain: 1 } },
  { id: "london", name: "London", country: "United Kingdom", lat: 51.48, lon: 0.9, size: 2, harbor: "river", fuelPrice: 465, exports: { machinery: 3, containers: 3, textiles: 2 } },
  { id: "lisbon", name: "Lisbon", country: "Portugal", lat: 38.7, lon: -9.15, size: 1, harbor: "river", fuelPrice: 455, exports: { textiles: 3, cement: 2, fruit: 2 } },
  { id: "piraeus", name: "Piraeus", country: "Greece", lat: 37.94, lon: 23.6, size: 2, harbor: "open", fuelPrice: 460, exports: { cement: 3, textiles: 2, fruit: 2, containers: 2 } },
  { id: "istanbul", name: "Istanbul", country: "Türkiye", lat: 41.0, lon: 28.95, size: 2, harbor: "basin", fuelPrice: 450, exports: { textiles: 4, machinery: 2, cement: 2 } },
  { id: "alexandria", name: "Alexandria", country: "Egypt", lat: 31.2, lon: 29.9, size: 2, harbor: "basin", fuelPrice: 430, exports: { textiles: 3, fruit: 2, cement: 2 } },
  { id: "dubai", name: "Dubai", country: "UAE", lat: 25.27, lon: 55.3, size: 3, harbor: "open", fuelPrice: 400, exports: { "crude-oil": 4, containers: 4, chemicals: 2, machinery: 2 } },
  { id: "mumbai", name: "Mumbai", country: "India", lat: 18.95, lon: 72.83, size: 3, harbor: "basin", fuelPrice: 425, exports: { textiles: 4, containers: 3, machinery: 2, grain: 2 } },
  { id: "singapore", name: "Singapore", country: "Singapore", lat: 1.26, lon: 103.85, size: 3, harbor: "open", fuelPrice: 395, exports: { containers: 5, electronics: 3, chemicals: 3, machinery: 2 } },
  { id: "hong-kong", name: "Hong Kong", country: "China", lat: 22.29, lon: 114.16, size: 3, harbor: "basin", fuelPrice: 410, exports: { electronics: 4, containers: 4, textiles: 3 } },
  { id: "shanghai", name: "Shanghai", country: "China", lat: 31.23, lon: 121.49, size: 3, harbor: "river", fuelPrice: 415, exports: { containers: 5, electronics: 4, machinery: 3, textiles: 2 } },
  { id: "yokohama", name: "Yokohama", country: "Japan", lat: 35.45, lon: 139.65, size: 3, harbor: "basin", fuelPrice: 445, exports: { automobiles: 5, electronics: 4, machinery: 3 } },
  { id: "sydney", name: "Sydney", country: "Australia", lat: -33.86, lon: 151.2, size: 2, harbor: "basin", fuelPrice: 455, exports: { coal: 4, grain: 3, "iron-ore": 3 } },
  { id: "cape-town", name: "Cape Town", country: "South Africa", lat: -33.9, lon: 18.42, size: 2, harbor: "open", fuelPrice: 440, exports: { fruit: 3, "iron-ore": 3, coal: 2 } },
  { id: "lagos", name: "Lagos", country: "Nigeria", lat: 6.45, lon: 3.4, size: 2, harbor: "river", fuelPrice: 420, exports: { "crude-oil": 4, timber: 2, coffee: 1 } },
  { id: "santos", name: "Santos", country: "Brazil", lat: -23.96, lon: -46.33, size: 2, harbor: "river", fuelPrice: 435, exports: { coffee: 4, grain: 3, "iron-ore": 3, fruit: 2 } },
  { id: "buenos-aires", name: "Buenos Aires", country: "Argentina", lat: -34.6, lon: -58.37, size: 2, harbor: "river", fuelPrice: 440, exports: { grain: 4, fruit: 2, timber: 1 } },
  { id: "valparaiso", name: "Valparaíso", country: "Chile", lat: -33.04, lon: -71.62, size: 1, harbor: "open", fuelPrice: 450, exports: { fruit: 3, "iron-ore": 2, timber: 1 } },
  { id: "new-york", name: "New York", country: "United States", lat: 40.7, lon: -74.0, size: 3, harbor: "basin", fuelPrice: 460, exports: { containers: 4, machinery: 3, grain: 2, chemicals: 2 } },
  { id: "new-orleans", name: "New Orleans", country: "United States", lat: 29.95, lon: -90.06, size: 2, harbor: "river", fuelPrice: 430, exports: { grain: 4, "crude-oil": 3, chemicals: 2 } },
  { id: "vancouver", name: "Vancouver", country: "Canada", lat: 49.29, lon: -123.11, size: 2, harbor: "open", fuelPrice: 450, exports: { timber: 4, grain: 3, coal: 2 } },
  { id: "los-angeles", name: "Los Angeles", country: "United States", lat: 33.74, lon: -118.26, size: 3, harbor: "basin", fuelPrice: 455, exports: { containers: 4, electronics: 2, machinery: 2, fruit: 2 } },
];

const portById = new Map(PORTS.map((port) => [port.id, port]));

export function port(id: string): Port {
  const found = portById.get(id);
  if (!found) throw new Error(`unknown port: ${id}`);
  return found;
}

export function isPortId(id: string): boolean {
  return portById.has(id);
}

// ── Ship models ──────────────────────────────────────────────────────────────

export type ShipModel = {
  readonly id: string;
  readonly name: string;
  /** Deadweight tonnage — the cargo lot ceiling. */
  readonly dwt: number;
  readonly maxSpeed: number;
  /** The economical speed the fuel curve is anchored to. */
  readonly cruiseSpeed: number;
  /** Tons of bunker fuel per day at cruise speed. */
  readonly fuelPerDay: number;
  readonly fuelTank: number;
  /** Crew wages, dollars per day, charterer pays while chartered out. */
  readonly crewPerDay: number;
  readonly priceNew: number;
  readonly carries: readonly CargoKind[];
  /** Rudder feel in the docking basin: 1 nimble … 3 a brick. */
  readonly handling: 1 | 2 | 3;
};

export const SHIP_MODELS: readonly ShipModel[] = [
  {
    id: "coaster",
    name: "Coastal trader",
    dwt: 3200,
    maxSpeed: 12.5,
    cruiseSpeed: 10.5,
    fuelPerDay: 6,
    fuelTank: 110,
    crewPerDay: 1100,
    priceNew: 820_000,
    carries: ["dry", "container"],
    handling: 1,
  },
  {
    id: "tramp",
    name: "Tramp freighter",
    dwt: 8500,
    maxSpeed: 14.5,
    cruiseSpeed: 12,
    fuelPerDay: 13,
    fuelTank: 280,
    crewPerDay: 1900,
    priceNew: 1_850_000,
    carries: ["dry", "container"],
    handling: 2,
  },
  {
    id: "handysize",
    name: "Handysize bulker",
    dwt: 21_000,
    maxSpeed: 15,
    cruiseSpeed: 13,
    fuelPerDay: 21,
    fuelTank: 480,
    crewPerDay: 2600,
    priceNew: 3_600_000,
    carries: ["dry"],
    handling: 2,
  },
  {
    id: "panamax",
    name: "Panamax bulker",
    dwt: 44_000,
    maxSpeed: 16,
    cruiseSpeed: 13.5,
    fuelPerDay: 32,
    fuelTank: 950,
    crewPerDay: 3400,
    priceNew: 7_200_000,
    carries: ["dry"],
    handling: 3,
  },
  {
    id: "liner",
    name: "Container liner",
    dwt: 28_000,
    maxSpeed: 21.5,
    cruiseSpeed: 18.5,
    fuelPerDay: 48,
    fuelTank: 1150,
    crewPerDay: 3800,
    priceNew: 8_900_000,
    carries: ["container"],
    handling: 3,
  },
  {
    id: "tanker",
    name: "Products tanker",
    dwt: 36_000,
    maxSpeed: 15.5,
    cruiseSpeed: 13,
    fuelPerDay: 26,
    fuelTank: 720,
    crewPerDay: 3000,
    priceNew: 6_100_000,
    carries: ["liquid"],
    handling: 3,
  },
];

const modelById = new Map(SHIP_MODELS.map((model) => [model.id, model]));

export function shipModel(id: string): ShipModel {
  const found = modelById.get(id);
  if (!found) throw new Error(`unknown ship model: ${id}`);
  return found;
}

/** Ship names the used market christens its hulls with. */
export const SHIP_NAMES: readonly string[] = [
  "Kestrel", "Wanderer", "Guillemot", "Albatross", "Meridian", "Argosy",
  "Petrel", "Sea Lark", "Trade Wind", "Corposant", "Ithaca", "Halcyon",
  "Windward", "Cormorant", "Baltica", "Southern Cross", "Aurora", "Levant",
  "Monsoon", "Spindrift", "Vagabond", "Northern Light", "Pelican", "Zephyr",
];

// ── Sea lanes ────────────────────────────────────────────────────────────────

/**
 * Waypoints pin the lanes to straits, canals and capes so a route drawn on the
 * chart stays on water. Hand-placed; `nav.test.ts` proves every pair of ports
 * is connected, and the debug renderer in `scripts/` exists to eyeball them.
 */
export type Waypoint = { readonly id: string; readonly lat: number; readonly lon: number };

export const WAYPOINTS: readonly Waypoint[] = [
  // North Sea & Baltic approaches
  { id: "w-skagen", lat: 58.0, lon: 10.8 },
  { id: "w-jutland", lat: 57.2, lon: 7.8 },
  { id: "w-helgoland", lat: 54.2, lon: 7.5 },
  { id: "w-terschelling", lat: 53.6, lon: 4.5 },
  // Channel & eastern Atlantic
  { id: "w-foreland", lat: 51.5, lon: 1.75 },
  { id: "w-dover", lat: 50.85, lon: 1.5 },
  { id: "w-channel", lat: 50.1, lon: -1.4 },
  { id: "w-ushant", lat: 48.6, lon: -5.8 },
  { id: "w-finisterre", lat: 43.3, lon: -9.9 },
  { id: "w-roca", lat: 38.9, lon: -9.9 },
  { id: "w-st-vincent", lat: 36.9, lon: -9.5 },
  { id: "w-gibraltar", lat: 35.9, lon: -6.2 },
  { id: "w-canary", lat: 28.2, lon: -16.5 },
  { id: "w-dakar", lat: 14.7, lon: -18.5 },
  { id: "w-freetown", lat: 5.8, lon: -15.0 },
  { id: "w-guinea", lat: 1.5, lon: 2.0 },
  // Mediterranean & Suez
  { id: "w-alboran", lat: 36.0, lon: -2.0 },
  { id: "w-balearic", lat: 38.2, lon: 4.0 },
  { id: "w-sicily", lat: 37.3, lon: 11.4 },
  { id: "w-malta", lat: 36.0, lon: 15.0 },
  { id: "w-matapan", lat: 36.2, lon: 22.4 },
  { id: "w-kithira", lat: 35.3, lon: 23.3 },
  { id: "w-malea", lat: 36.35, lon: 23.3 },
  { id: "w-saronic", lat: 37.6, lon: 23.45 },
  { id: "w-sounion", lat: 37.55, lon: 24.05 },
  { id: "w-aegean", lat: 38.9, lon: 25.3 },
  { id: "w-dardanelles", lat: 40.05, lon: 26.2 },
  { id: "w-marmara", lat: 40.7, lon: 27.8 },
  { id: "w-delta", lat: 31.9, lon: 31.2 },
  { id: "w-suez-north", lat: 31.3, lon: 32.35 },
  { id: "w-suez-south", lat: 28.5, lon: 33.2 },
  { id: "w-bab-el-mandeb", lat: 12.5, lon: 43.3 },
  { id: "w-guardafui", lat: 12.1, lon: 51.8 },
  // Indian Ocean
  { id: "w-arabian-sea", lat: 18.5, lon: 58.5 },
  { id: "w-ras-al-hadd", lat: 22.3, lon: 60.2 },
  { id: "w-hormuz", lat: 26.3, lon: 56.7 },
  { id: "w-gulf", lat: 26.5, lon: 55.8 },
  { id: "w-malabar", lat: 9.0, lon: 75.2 },
  { id: "w-comorin", lat: 6.9, lon: 77.2 },
  { id: "w-ceylon", lat: 5.6, lon: 80.7 },
  { id: "w-mascarene", lat: -26.0, lon: 57.5 },
  // Southern Africa
  { id: "w-agulhas", lat: -36.0, lon: 20.5 },
  { id: "w-cape-point", lat: -34.6, lon: 18.0 },
  { id: "w-algoa", lat: -34.8, lon: 26.5 },
  { id: "w-durban", lat: -30.5, lon: 32.5 },
  { id: "w-inhambane", lat: -24.5, lon: 36.0 },
  { id: "w-mozambique", lat: -20.0, lon: 37.0 },
  { id: "w-mozambique-n", lat: -16.5, lon: 41.5 },
  { id: "w-comoro", lat: -11.5, lon: 41.5 },
  { id: "w-somali-basin", lat: 0.0, lon: 48.0 },
  // East Asia & Pacific
  { id: "w-malacca", lat: 6.0, lon: 95.0 },
  { id: "w-malacca-n", lat: 5.0, lon: 98.8 },
  { id: "w-malacca-s", lat: 2.0, lon: 101.7 },
  { id: "w-sunda", lat: -6.3, lon: 105.1 },
  { id: "w-batavia", lat: -5.5, lon: 107.0 },
  { id: "w-java-sea", lat: -5.5, lon: 112.5 },
  { id: "w-banda", lat: -6.0, lon: 131.5 },
  { id: "w-torres", lat: -10.5, lon: 142.1 },
  { id: "w-coral", lat: -18.5, lon: 155.5 },
  { id: "w-byron", lat: -28.6, lon: 154.3 },
  { id: "w-hunter", lat: -32.6, lon: 152.8 },
  { id: "w-solomon", lat: -8.0, lon: 158.0 },
  { id: "w-south-china", lat: 12.0, lon: 110.5 },
  { id: "w-philippine", lat: 16.0, lon: 129.0 },
  { id: "w-pratas", lat: 22.0, lon: 116.5 },
  { id: "w-taiwan", lat: 24.2, lon: 119.3 },
  { id: "w-east-china", lat: 26.8, lon: 123.5 },
  { id: "w-osumi", lat: 30.5, lon: 131.2 },
  { id: "w-izu", lat: 34.1, lon: 139.5 },
  { id: "w-south-pacific", lat: -16.0, lon: -145.0 },
  // Americas
  { id: "w-panama-pacific", lat: 7.8, lon: -79.6 },
  { id: "w-panama-atlantic", lat: 9.4, lon: -79.9 },
  { id: "w-yucatan", lat: 22.3, lon: -86.0 },
  { id: "w-florida", lat: 24.2, lon: -80.4 },
  { id: "w-hatteras", lat: 35.3, lon: -74.8 },
  { id: "w-ambrose", lat: 40.3, lon: -73.6 },
  { id: "w-cabo", lat: 22.5, lon: -110.5 },
  { id: "w-baja", lat: 28.2, lon: -116.2 },
  { id: "w-conception", lat: 34.3, lon: -120.8 },
  { id: "w-mendocino", lat: 40.4, lon: -125.0 },
  { id: "w-flattery", lat: 48.4, lon: -125.2 },
  { id: "w-tehuantepec", lat: 14.0, lon: -96.0 },
  { id: "w-mala", lat: 6.8, lon: -80.5 },
  { id: "w-cocos", lat: 7.0, lon: -86.0 },
  { id: "w-guayaquil", lat: -3.5, lon: -81.5 },
  { id: "w-paita", lat: -5.5, lon: -81.8 },
  { id: "w-callao", lat: -12.2, lon: -77.6 },
  { id: "w-chiloe", lat: -43.5, lon: -77.0 },
  { id: "w-magallanes", lat: -54.5, lon: -76.0 },
  { id: "w-cape-horn", lat: -56.8, lon: -66.5 },
  { id: "w-le-maire", lat: -54.5, lon: -63.5 },
  { id: "w-plata", lat: -36.0, lon: -54.5 },
  { id: "w-santa-marta", lat: -28.6, lon: -48.2 },
  { id: "w-cabo-frio", lat: -23.5, lon: -41.6 },
  { id: "w-recife", lat: -6.5, lon: -33.5 },
];

/** A canal levies a toll; a piracy weight raises the odds of trouble. */
export type SeaLane = {
  readonly a: string;
  readonly b: string;
  readonly canal?: "suez" | "panama";
  readonly piracy?: number;
};

export const SEA_LANES: readonly SeaLane[] = [
  // Northern Europe
  { a: "oslo", b: "w-skagen" },
  { a: "w-skagen", b: "w-jutland" },
  { a: "w-jutland", b: "w-helgoland" },
  { a: "w-helgoland", b: "hamburg" },
  { a: "w-helgoland", b: "w-terschelling" },
  { a: "w-terschelling", b: "rotterdam" },
  { a: "rotterdam", b: "w-dover" },
  { a: "rotterdam", b: "london" },
  { a: "london", b: "w-foreland" },
  { a: "w-foreland", b: "w-dover" },
  { a: "w-dover", b: "w-channel" },
  { a: "w-channel", b: "w-ushant" },
  { a: "w-ushant", b: "w-finisterre" },
  { a: "w-finisterre", b: "w-roca" },
  { a: "w-roca", b: "lisbon" },
  { a: "w-finisterre", b: "w-st-vincent" },
  { a: "lisbon", b: "w-st-vincent" },
  { a: "w-st-vincent", b: "w-gibraltar" },
  // Atlantic crossings
  { a: "w-channel", b: "new-york" },
  { a: "w-ushant", b: "new-york" },
  { a: "w-gibraltar", b: "new-york" },
  { a: "w-finisterre", b: "w-recife" },
  { a: "w-gibraltar", b: "w-canary" },
  { a: "w-canary", b: "w-dakar" },
  { a: "w-canary", b: "w-recife" },
  { a: "w-dakar", b: "w-freetown" },
  { a: "w-dakar", b: "w-recife" },
  { a: "w-freetown", b: "w-guinea" },
  { a: "w-guinea", b: "lagos", piracy: 0.3 },
  { a: "w-guinea", b: "cape-town" },
  // Mediterranean & Suez
  { a: "w-gibraltar", b: "w-alboran" },
  { a: "w-alboran", b: "w-balearic" },
  { a: "w-balearic", b: "w-sicily" },
  { a: "w-sicily", b: "w-malta" },
  { a: "w-malta", b: "w-matapan" },
  { a: "w-matapan", b: "w-malea" },
  { a: "w-malea", b: "w-saronic" },
  { a: "w-saronic", b: "piraeus" },
  { a: "piraeus", b: "w-sounion" },
  { a: "w-sounion", b: "w-aegean" },
  { a: "w-aegean", b: "w-dardanelles" },
  { a: "w-dardanelles", b: "w-marmara" },
  { a: "w-marmara", b: "istanbul" },
  { a: "w-matapan", b: "w-kithira" },
  { a: "w-kithira", b: "alexandria" },
  { a: "w-sicily", b: "alexandria" },
  { a: "alexandria", b: "w-delta" },
  { a: "w-delta", b: "w-suez-north" },
  { a: "w-suez-north", b: "w-suez-south", canal: "suez" },
  { a: "w-suez-south", b: "w-bab-el-mandeb" },
  { a: "w-bab-el-mandeb", b: "w-guardafui", piracy: 0.35 },
  // Indian Ocean
  { a: "w-guardafui", b: "w-arabian-sea" },
  { a: "w-arabian-sea", b: "w-ras-al-hadd" },
  { a: "w-ras-al-hadd", b: "w-hormuz" },
  { a: "w-hormuz", b: "w-gulf" },
  { a: "w-gulf", b: "dubai" },
  { a: "w-ras-al-hadd", b: "mumbai" },
  { a: "w-guardafui", b: "mumbai" },
  { a: "w-guardafui", b: "w-comorin" },
  { a: "mumbai", b: "w-malabar" },
  { a: "w-malabar", b: "w-comorin" },
  { a: "w-comorin", b: "w-ceylon" },
  { a: "w-ceylon", b: "w-malacca" },
  { a: "w-malacca", b: "w-malacca-n", piracy: 0.25 },
  { a: "w-malacca-n", b: "w-malacca-s", piracy: 0.25 },
  { a: "w-malacca-s", b: "singapore", piracy: 0.25 },
  { a: "w-guardafui", b: "w-somali-basin" },
  { a: "w-somali-basin", b: "w-comoro" },
  { a: "w-comoro", b: "w-mozambique-n" },
  { a: "w-mozambique-n", b: "w-mozambique" },
  { a: "w-mozambique", b: "w-inhambane" },
  { a: "w-inhambane", b: "w-durban" },
  { a: "w-durban", b: "w-algoa" },
  { a: "w-algoa", b: "w-agulhas" },
  { a: "w-agulhas", b: "w-cape-point" },
  { a: "w-cape-point", b: "cape-town" },
  { a: "w-durban", b: "w-mascarene" },
  { a: "w-algoa", b: "w-mascarene" },
  { a: "w-mascarene", b: "w-ceylon" },
  { a: "w-mascarene", b: "w-sunda" },
  { a: "w-sunda", b: "w-batavia" },
  { a: "w-batavia", b: "w-java-sea" },
  // South Atlantic
  { a: "cape-town", b: "w-recife" },
  { a: "cape-town", b: "w-plata" },
  { a: "w-recife", b: "new-york" },
  { a: "w-recife", b: "lagos" },
  { a: "w-recife", b: "w-cabo-frio" },
  { a: "w-cabo-frio", b: "santos" },
  { a: "santos", b: "w-santa-marta" },
  { a: "w-santa-marta", b: "w-plata" },
  { a: "w-plata", b: "buenos-aires" },
  { a: "w-plata", b: "w-le-maire" },
  { a: "w-le-maire", b: "w-cape-horn" },
  // Pacific South America
  { a: "w-cape-horn", b: "w-magallanes" },
  { a: "w-magallanes", b: "w-chiloe" },
  { a: "w-chiloe", b: "valparaiso" },
  { a: "valparaiso", b: "w-callao" },
  { a: "w-callao", b: "w-paita" },
  { a: "w-paita", b: "w-guayaquil" },
  { a: "w-guayaquil", b: "w-panama-pacific" },
  // Panama & Caribbean
  { a: "w-panama-pacific", b: "w-panama-atlantic", canal: "panama" },
  { a: "w-panama-atlantic", b: "w-yucatan" },
  { a: "w-yucatan", b: "new-orleans" },
  { a: "w-yucatan", b: "w-florida" },
  { a: "new-orleans", b: "w-florida" },
  { a: "w-florida", b: "w-hatteras" },
  { a: "w-hatteras", b: "w-ambrose" },
  { a: "w-ambrose", b: "new-york" },
  // Pacific North America
  { a: "w-panama-pacific", b: "w-mala" },
  { a: "w-mala", b: "w-cocos" },
  { a: "w-cocos", b: "w-tehuantepec" },
  { a: "w-tehuantepec", b: "w-cabo" },
  { a: "w-cabo", b: "w-baja" },
  { a: "w-baja", b: "los-angeles" },
  { a: "los-angeles", b: "w-conception" },
  { a: "w-conception", b: "w-mendocino" },
  { a: "w-mendocino", b: "w-flattery" },
  { a: "w-flattery", b: "vancouver" },
  // Transpacific
  { a: "yokohama", b: "vancouver" },
  { a: "yokohama", b: "los-angeles" },
  { a: "w-south-pacific", b: "los-angeles" },
  { a: "w-south-pacific", b: "w-panama-pacific" },
  { a: "w-south-pacific", b: "valparaiso" },
  { a: "w-solomon", b: "w-south-pacific" },
  // East Asia & Australia
  { a: "singapore", b: "w-south-china", piracy: 0.12 },
  { a: "w-south-china", b: "hong-kong", piracy: 0.12 },
  { a: "hong-kong", b: "w-pratas" },
  { a: "w-pratas", b: "w-taiwan" },
  { a: "w-taiwan", b: "w-east-china" },
  { a: "w-east-china", b: "w-osumi" },
  { a: "shanghai", b: "w-osumi" },
  { a: "w-east-china", b: "shanghai" },
  { a: "w-osumi", b: "w-izu" },
  { a: "w-izu", b: "yokohama" },
  { a: "hong-kong", b: "w-philippine" },
  { a: "yokohama", b: "w-philippine" },
  { a: "w-philippine", b: "w-banda" },
  { a: "singapore", b: "w-java-sea" },
  { a: "w-java-sea", b: "w-banda" },
  { a: "w-banda", b: "w-torres" },
  { a: "w-torres", b: "w-coral" },
  { a: "w-coral", b: "w-byron" },
  { a: "w-byron", b: "w-hunter" },
  { a: "w-hunter", b: "sydney" },
  { a: "w-coral", b: "w-solomon" },
  { a: "w-solomon", b: "yokohama" },
];
