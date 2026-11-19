export const CLEARANCE_MODES = ["block", "warn", "off"] as const;

export type ClearanceMode = (typeof CLEARANCE_MODES)[number];

export type SubjectKind = "submission" | "policy" | "client_account" | "change_request";

export type UsageRole = "location" | "mailing";

export interface SubjectRef {
  kind: SubjectKind;
  id: string;
}

export interface AddressUsage {
  addressId: string;
  subject: SubjectRef;
  label: string;
  role: UsageRole;
  productId: string | null;
  producer: { id: string; name: string } | null;
  active: boolean;
}

export interface Clearance {
  mode: ClearanceMode;
  outcome: "clear" | "warn" | "block";
  conflicts: AddressUsage[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The product's duplicate-risk setting from its lifecycle config (`clearance.duplicateRisk`). */
export function clearanceModeFrom(lifecycle: Record<string, unknown>): ClearanceMode {
  const value = isRecord(lifecycle.clearance) ? lifecycle.clearance.duplicateRisk : undefined;

  return CLEARANCE_MODES.find((mode) => mode === value) ?? "warn";
}

const sameSubject = (a: SubjectRef, b: SubjectRef) => a.kind === b.kind && a.id === b.id;

/**
 * Clearance (PLAN §15.9): a risk location that already has an active submission or policy by
 * another producer is a possible duplicate. The product decides whether that warns or blocks.
 */
export function decideClearance(input: {
  mode: ClearanceMode;
  subject: SubjectRef;
  /** The same risk under another subject, such as the policy bound from this submission. */
  related?: readonly SubjectRef[];
  producerId: string | null;
  addressIds: readonly string[];
  usages: readonly AddressUsage[];
}): Clearance {
  if (input.mode === "off") return { mode: input.mode, outcome: "clear", conflicts: [] };

  const ids = new Set(input.addressIds);
  const own = [input.subject, ...(input.related ?? [])];
  const seen = new Set<string>();

  const conflicts = input.usages.filter((usage) => {
    const key = `${usage.subject.kind}:${usage.subject.id}`;

    const conflicting =
      usage.active &&
      usage.role === "location" &&
      ids.has(usage.addressId) &&
      !own.some((ref) => sameSubject(ref, usage.subject)) &&
      usage.producer?.id !== input.producerId &&
      !seen.has(key);

    if (conflicting) seen.add(key);

    return conflicting;
  });

  return {
    mode: input.mode,
    outcome: conflicts.length === 0 ? "clear" : input.mode,
    conflicts,
  };
}
