export interface Jurisdiction {
  country: string;
  subdivision?: string;
}

const US_SUBDIVISIONS: Record<string, string> = {
  "US-AL": "Alabama",
  "US-AK": "Alaska",
  "US-AZ": "Arizona",
  "US-AR": "Arkansas",
  "US-CA": "California",
  "US-CO": "Colorado",
  "US-CT": "Connecticut",
  "US-DE": "Delaware",
  "US-DC": "District of Columbia",
  "US-FL": "Florida",
  "US-GA": "Georgia",
  "US-HI": "Hawaii",
  "US-ID": "Idaho",
  "US-IL": "Illinois",
  "US-IN": "Indiana",
  "US-IA": "Iowa",
  "US-KS": "Kansas",
  "US-KY": "Kentucky",
  "US-LA": "Louisiana",
  "US-ME": "Maine",
  "US-MD": "Maryland",
  "US-MA": "Massachusetts",
  "US-MI": "Michigan",
  "US-MN": "Minnesota",
  "US-MS": "Mississippi",
  "US-MO": "Missouri",
  "US-MT": "Montana",
  "US-NE": "Nebraska",
  "US-NV": "Nevada",
  "US-NH": "New Hampshire",
  "US-NJ": "New Jersey",
  "US-NM": "New Mexico",
  "US-NY": "New York",
  "US-NC": "North Carolina",
  "US-ND": "North Dakota",
  "US-OH": "Ohio",
  "US-OK": "Oklahoma",
  "US-OR": "Oregon",
  "US-PA": "Pennsylvania",
  "US-PR": "Puerto Rico",
  "US-RI": "Rhode Island",
  "US-SC": "South Carolina",
  "US-SD": "South Dakota",
  "US-TN": "Tennessee",
  "US-TX": "Texas",
  "US-UT": "Utah",
  "US-VT": "Vermont",
  "US-VA": "Virginia",
  "US-WA": "Washington",
  "US-WV": "West Virginia",
  "US-WI": "Wisconsin",
  "US-WY": "Wyoming",
};

export const SUBDIVISIONS: Record<string, Record<string, string>> = { US: US_SUBDIVISIONS };

export const COUNTRIES = ["US", "CA", "GB", "IE", "BM", "AU", "NZ"] as const;

const regionNames = new Intl.DisplayNames(undefined, { type: "region" });

export function countryName(code: string): string {
  return regionNames.of(code) ?? code;
}

export function subdivisionsOf(country: string): [code: string, name: string][] {
  return Object.entries(SUBDIVISIONS[country] ?? {});
}

export function jurisdictionName(j: Jurisdiction): string {
  if (!j.subdivision) return countryName(j.country);

  return SUBDIVISIONS[j.country]?.[j.subdivision] ?? j.subdivision;
}

export function jurisdictionShort(j: Jurisdiction): string {
  return j.subdivision ? j.subdivision.slice(j.country.length + 1) : j.country;
}

export function jurisdictionCode(j: Jurisdiction): string {
  return j.subdivision ?? j.country;
}
