import type { Instant, PlainDate } from "@pas/kernel";

export type LicenseSource = "manual" | "nipr";
export type LicenseStatus = "active" | "inactive";

export interface License {
  id: string;
  producerId: string;
  npn: string;
  country: string;
  subdivision: string;
  licenseNumber: string;
  linesOfAuthority: string[];
  effectiveDate: PlainDate;
  expirationDate: PlainDate | null;
  status: LicenseStatus;
  source: LicenseSource;
  verifiedAt: Instant | null;
  updatedAt: Instant;
}

export type LicensingMode = "block" | "warn" | "off";

export type LicenseCheck =
  | { ok: true; licenseNumber: string }
  | {
      ok: false;
      reason: "no_license" | "inactive" | "not_yet_effective" | "expired" | "line_missing";
      message: string;
    };

const normalized = (line: string) => line.trim().toLowerCase();

const formatDate = (date: PlainDate) =>
  date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * PLAN §11: the producer holds a license in the risk's subdivision, active and in force on the
 * effective date, with one of the lines of authority the product requires.
 */
export function checkLicense(
  licenses: readonly Pick<
    License,
    | "subdivision"
    | "licenseNumber"
    | "linesOfAuthority"
    | "effectiveDate"
    | "expirationDate"
    | "status"
  >[],
  input: { subdivision: string; linesOfAuthority: readonly string[]; on: PlainDate; place: string },
): LicenseCheck {
  const inState = licenses.filter((l) => l.subdivision === input.subdivision);

  if (inState.length === 0) {
    return { ok: false, reason: "no_license", message: `has no license in ${input.place}` };
  }

  const active = inState.filter((l) => l.status === "active");

  if (active.length === 0) {
    return { ok: false, reason: "inactive", message: `has no active license in ${input.place}` };
  }

  const compare = Temporal.PlainDate.compare;
  const started = active.filter((l) => compare(l.effectiveDate, input.on) <= 0);

  if (started.length === 0) {
    return {
      ok: false,
      reason: "not_yet_effective",
      message: `isn't licensed in ${input.place} until ${formatDate(active[0]!.effectiveDate)}`,
    };
  }

  const current = started.filter(
    (l) => !l.expirationDate || compare(l.expirationDate, input.on) >= 0,
  );

  if (current.length === 0) {
    const lapsed = started
      .map((l) => l.expirationDate!)
      .toSorted(compare)
      .at(-1)!;

    return {
      ok: false,
      reason: "expired",
      message: `has a ${input.place} license that expired on ${formatDate(lapsed)}`,
    };
  }

  const wanted = new Set(input.linesOfAuthority.map(normalized));

  const matching =
    wanted.size === 0
      ? current[0]
      : current.find((l) => l.linesOfAuthority.some((line) => wanted.has(normalized(line))));

  if (!matching) {
    return {
      ok: false,
      reason: "line_missing",
      message: `isn't licensed for ${new Intl.ListFormat("en-US", { type: "disjunction" }).format(input.linesOfAuthority)} in ${input.place}`,
    };
  }

  return { ok: true, licenseNumber: matching.licenseNumber };
}

export type LicenseHealth = "current" | "expiring" | "expired" | "inactive";

/** Admin warning: a license lapsing within `warnDays` needs renewing before it blocks binds. */
export function licenseHealth(
  license: Pick<License, "expirationDate" | "status">,
  today: PlainDate,
  warnDays: number,
): LicenseHealth {
  if (license.status !== "active") return "inactive";

  if (!license.expirationDate) return "current";

  const compare = Temporal.PlainDate.compare;

  if (compare(license.expirationDate, today) < 0) return "expired";

  return compare(license.expirationDate, today.add({ days: warnDays })) <= 0
    ? "expiring"
    : "current";
}
