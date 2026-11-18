import type { Instant } from "@pas/kernel";
import { type PostalAddress, postalKey } from "./contact";

const MAX_FAILURES = 5;
const WINDOW = Temporal.Duration.from({ hours: 1 });

export function claimWindowStart(now: Instant): Instant {
  return now.subtract(WINDOW);
}

/** Five wrong answers an hour, so a policy number can't be paired with ZIPs by brute force. */
export function claimAttemptsLeft(recentFailures: number): number {
  return Math.max(0, MAX_FAILURES - recentFailures);
}

export function postalCodeMatches(address: PostalAddress | null, given: string): boolean {
  if (!address) return false;

  const expected = postalKey(address.postalCode, address.country);

  return expected.length > 0 && expected === postalKey(given, address.country);
}
