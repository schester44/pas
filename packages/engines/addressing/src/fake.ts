import type {
  AddressInput,
  AddressProvider,
  AddressSuggestion,
  SuggestQuery,
  Verification,
} from "./address";
import { displayCase, standardStreet } from "./normalize";
import { standardizeOffline } from "./offline";

interface DemoCity {
  city: string;
  region: string;
  zips: readonly string[];
  county: { name: string; fips: string };
  center: readonly [number, number];
  streets: readonly string[];
  /** Streets whose buildings have units, to show unit selection. */
  buildings: readonly string[];
}

const CITIES: readonly DemoCity[] = [
  {
    city: "Evanston",
    region: "IL",
    zips: ["60201", "60202"],
    county: { name: "Cook", fips: "17031" },
    center: [42.0451, -87.6877],
    streets: [
      "Sherman Ave",
      "Chicago Ave",
      "Davis St",
      "Church St",
      "Ridge Ave",
      "Central St",
      "Elmwood Ave",
      "Orrington Ave",
    ],
    buildings: ["Chicago Ave", "Sherman Ave"],
  },
  {
    city: "Chicago",
    region: "IL",
    zips: ["60614", "60601", "60606", "60657"],
    county: { name: "Cook", fips: "17031" },
    center: [41.8781, -87.6298],
    streets: [
      "N Lake Shore Dr",
      "N Clark St",
      "W Fullerton Ave",
      "N Halsted St",
      "S Wacker Dr",
      "W Armitage Ave",
      "Main St",
    ],
    buildings: ["N Lake Shore Dr", "S Wacker Dr"],
  },
  {
    city: "Oak Park",
    region: "IL",
    zips: ["60302", "60304"],
    county: { name: "Cook", fips: "17031" },
    center: [41.885, -87.7845],
    streets: ["Maple St", "Lake St", "Oak Park Ave", "Euclid Ave"],
    buildings: [],
  },
  {
    city: "Whiting",
    region: "IN",
    zips: ["46394"],
    county: { name: "Lake", fips: "18089" },
    center: [41.6798, -87.4945],
    streets: ["119th St", "Indianapolis Blvd", "Lakefront Dr", "Calumet Ave", "Front St"],
    buildings: [],
  },
  {
    city: "Indianapolis",
    region: "IN",
    zips: ["46204", "46220", "46202"],
    county: { name: "Marion", fips: "18097" },
    center: [39.7684, -86.1581],
    streets: [
      "N Meridian St",
      "Massachusetts Ave",
      "E Washington St",
      "N College Ave",
      "Monument Cir",
    ],
    buildings: ["N Meridian St"],
  },
];

const UNITS = ["1A", "1B", "2A", "2B", "3A", "3B"];

/** House numbers from here up don't verify, so the unverified path can be tried in demo cities. */
const UNKNOWN_FROM = 9000;

function hash(value: string): number {
  let h = 2166136261;

  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

const digits = (value: string, length: number) =>
  String(hash(value) % 10 ** length).padStart(length, "0");

function cityOf(input: Pick<AddressInput, "city" | "region" | "postalCode">): DemoCity | undefined {
  const city = input.city.trim().toUpperCase();
  const region = input.region.trim().toUpperCase();
  const zip = input.postalCode.replace(/\D/g, "").slice(0, 5);

  return (
    CITIES.find((c) => c.city.toUpperCase() === city && c.region === region) ??
    CITIES.find((c) => zip && c.zips.includes(zip))
  );
}

const isBuilding = (city: DemoCity, street: string) =>
  city.buildings.some((b) => standardStreet(b) === standardStreet(street));

function verify(input: AddressInput, id: string): Verification {
  const offline = standardizeOffline(input, id);
  const city = cityOf(input);
  const [number, ...rest] = offline.address.line1.split(" ");
  const houseNumber = Number.parseInt(number ?? "", 10);

  if (!city || !Number.isFinite(houseNumber) || houseNumber >= UNKNOWN_FROM || rest.length === 0) {
    return { ...offline, notes: ["No match for this address"] };
  }

  const street = rest.join(" ");
  const zip = offline.address.postalCode;
  const postalCode = city.zips.includes(zip) ? zip : city.zips[0]!;
  const point = `${standardStreet(offline.address.line1)}|${city.city}|${city.region}`;
  const unitMissing = isBuilding(city, street) && !offline.address.line2;
  const unitKey = `${point}|${offline.address.line2 ?? ""}`;
  const spread = (salt: string) => ((hash(`${unitKey}${salt}`) % 2000) - 1000) / 50_000;

  return {
    status: "verified",
    provider: id,
    providerAddressId: digits(point, 10),
    address: {
      ...offline.address,
      line1: `${houseNumber} ${displayCase(standardStreet(street))}`,
      city: city.city,
      region: city.region,
      postalCode,
      plus4: digits(unitKey, 4),
      county: city.county,
    },
    dpv: { match: unitMissing ? "D" : "Y", vacant: false, deliverable: true },
    geocode: {
      latitude: Number((city.center[0] + spread("lat")).toFixed(6)),
      longitude: Number((city.center[1] + spread("lng")).toFixed(6)),
      precision: "rooftop",
      source: id,
    },
    notes: unitMissing ? ["This building has units; add the apartment or unit"] : [],
  };
}

const bare = (street: string) => standardStreet(street).replace(/^(N|S|E|W) /, "");

function suggest(query: SuggestQuery): AddressSuggestion[] {
  if (query.selected) {
    const [line1, city, region, postalCode] = query.selected.split("|");

    return UNITS.slice(0, query.limit).map((unit) => ({
      line1: line1!,
      line2: `Apt ${unit}`,
      city: city!,
      region: region!,
      postalCode: postalCode!,
      country: "US",
    }));
  }

  const match = /^\s*(\d+)?\s*(.*)$/.exec(query.text)!;
  const number = match[1] ?? "100";
  const typed = standardStreet(match[2]!.split(",")[0]!);

  return CITIES.flatMap((city) =>
    city.streets
      .filter(
        (street) =>
          !typed || standardStreet(street).startsWith(typed) || bare(street).startsWith(typed),
      )
      .map((street) => {
        const line1 = `${number} ${street}`;
        const postalCode = city.zips[0]!;

        return {
          line1,
          city: city.city,
          region: city.region,
          postalCode,
          country: "US",
          ...(isBuilding(city, street) && {
            entries: UNITS.length,
            selected: [line1, city.city, city.region, postalCode].join("|"),
          }),
        };
      }),
  ).slice(0, query.limit);
}

/**
 * The built-in address provider (CLAUDE.md rule 10): deterministic suggestions and verification
 * for a few demo cities, offline standardization for everything else. Used by default and in sandboxes.
 */
export function createFakeAddressProvider(id = "builtin_address"): AddressProvider {
  return {
    id,
    suggest: async (query) => suggest(query),
    verify: async (input) => verify(input, id),
  };
}

export const DEMO_CITIES = CITIES.map((c) => `${c.city}, ${c.region}`);
