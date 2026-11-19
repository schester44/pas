import type { Instant } from "@pas/kernel";
import type { CanonicalInput } from "./canonical";
import type { Capability } from "./connector";
import type { CarrierOutcome } from "./outcome";

export interface RecordedExchange {
  stepId: string;
  method: string;
  url: string;
  response: { status: number; headers: Record<string, string>; body: unknown } | null;
  error: string | null;
}

/** A recorded run: replayed against a definition with a mock HTTP layer by the test suite. */
export interface Fixture {
  id: string;
  carrierId: string;
  capability: Capability;
  name: string;
  input: CanonicalInput;
  exchanges: RecordedExchange[];
  callbacks: { body: unknown }[];
  expected: CarrierOutcome;
  createdAt: Instant;
}
