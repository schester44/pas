import type { Instant, PlainDate } from "../dates";

/**
 * The only source of "now". Sandboxes run with an offset clock (time travel), so
 * domain and application code must never call Date.now() / Temporal.Now directly.
 */
export interface Clock {
  now(): Instant;
  today(timeZone: string): PlainDate;
}

export const systemClock: Clock = {
  now: () => Temporal.Now.instant(),
  today: (timeZone) => Temporal.Now.plainDateISO(timeZone),
};

export function offsetClock(base: Clock, offset: Temporal.Duration): Clock {
  return {
    now: () => base.now().add(offset),
    today: (timeZone) => base.now().add(offset).toZonedDateTimeISO(timeZone).toPlainDate(),
  };
}
