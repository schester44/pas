import { jurisdiction, type Jurisdiction, parsePlainDate, type PlainDate } from "@pas/kernel";

/** Effective-date window, `from` inclusive and `to` exclusive. */
export interface DateWindow {
  from: PlainDate;
  to?: PlainDate;
}

export interface AvailabilityWindow {
  jurisdiction: Jurisdiction;
  newBusiness: DateWindow;
  renewal: DateWindow;
}

export type AvailabilityKind = "new_business" | "renewal";

export function windowFor(window: AvailabilityWindow, kind: AvailabilityKind): DateWindow {
  return kind === "new_business" ? window.newBusiness : window.renewal;
}

export function windowContains(window: DateWindow, date: PlainDate): boolean {
  if (Temporal.PlainDate.compare(date, window.from) < 0) return false;

  return window.to === undefined || Temporal.PlainDate.compare(date, window.to) < 0;
}

export function windowsOverlap(a: DateWindow, b: DateWindow): boolean {
  const aEndsBeforeB = a.to !== undefined && Temporal.PlainDate.compare(a.to, b.from) <= 0;
  const bEndsBeforeA = b.to !== undefined && Temporal.PlainDate.compare(b.to, a.from) <= 0;

  return !aEndsBeforeB && !bEndsBeforeA;
}

export interface DateWindowJson {
  from: string;
  to?: string;
}

export interface AvailabilityWindowJson {
  jurisdiction: Jurisdiction;
  newBusiness: DateWindowJson;
  renewal: DateWindowJson;
}

export function dateWindowToJson(window: DateWindow): DateWindowJson {
  return window.to
    ? { from: window.from.toString(), to: window.to.toString() }
    : { from: window.from.toString() };
}

function dateWindowFromJson(window: DateWindowJson): DateWindow {
  const from = parsePlainDate(window.from);

  return window.to ? { from, to: parsePlainDate(window.to) } : { from };
}

export function availabilityToJson(window: AvailabilityWindow): AvailabilityWindowJson {
  return {
    jurisdiction: window.jurisdiction,
    newBusiness: dateWindowToJson(window.newBusiness),
    renewal: dateWindowToJson(window.renewal),
  };
}

export function availabilityFromJson(json: AvailabilityWindowJson): AvailabilityWindow {
  return {
    jurisdiction: jurisdiction(json.jurisdiction.country, json.jurisdiction.subdivision),
    newBusiness: dateWindowFromJson(json.newBusiness),
    renewal: dateWindowFromJson(json.renewal),
  };
}
