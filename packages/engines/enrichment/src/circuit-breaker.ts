import type { Clock, Instant } from "@pas/kernel";

export interface CircuitBreaker {
  isOpen(providerId: string): boolean;
  recordSuccess(providerId: string): void;
  recordFailure(providerId: string): void;
}

/** Opens after consecutive failures and lets one trial call through once the cooldown passes. */
export function createCircuitBreaker(
  clock: Clock,
  { failureThreshold = 3, cooldown = Temporal.Duration.from({ seconds: 30 }) } = {},
): CircuitBreaker {
  const state = new Map<string, { failures: number; openUntil: Instant | null }>();

  return {
    isOpen(providerId) {
      const openUntil = state.get(providerId)?.openUntil;

      return !!openUntil && Temporal.Instant.compare(clock.now(), openUntil) < 0;
    },
    recordSuccess(providerId) {
      state.delete(providerId);
    },
    recordFailure(providerId) {
      const failures = (state.get(providerId)?.failures ?? 0) + 1;
      const openUntil = failures >= failureThreshold ? clock.now().add(cooldown) : null;

      state.set(providerId, { failures, openUntil });
    },
  };
}
