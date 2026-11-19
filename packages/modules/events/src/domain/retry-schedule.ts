/**
 * Waits after each failed attempt: eight attempts spread over about a day, so a receiver that's
 * down overnight still gets every event once it's back.
 */
export const RETRY_DELAYS: readonly Temporal.Duration[] = [
  Temporal.Duration.from({ minutes: 1 }),
  Temporal.Duration.from({ minutes: 5 }),
  Temporal.Duration.from({ minutes: 30 }),
  Temporal.Duration.from({ hours: 2 }),
  Temporal.Duration.from({ hours: 5 }),
  Temporal.Duration.from({ hours: 8 }),
  Temporal.Duration.from({ hours: 8 }),
];

export const MAX_ATTEMPTS = RETRY_DELAYS.length + 1;

/** The wait before the next try after `attempt` failed (1-based), or null once retries are spent. */
export function retryDelay(attempt: number): Temporal.Duration | null {
  return RETRY_DELAYS[attempt - 1] ?? null;
}

/** A destination that has failed without a single success for this long gets disabled. */
export const DISABLE_AFTER = Temporal.Duration.from({ hours: 24 });
