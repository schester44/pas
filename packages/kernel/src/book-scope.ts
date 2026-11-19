import type { UserId } from "./tenant";

/**
 * Whose book a caller may see (PLAN §5.7): the tenant's whole book, one producer's own production,
 * or everything written through a set of agencies (an agency and its sub-agencies).
 */
export type BookScope =
  | { kind: "tenant" }
  | { kind: "producer"; producerId: UserId }
  | { kind: "agencies"; agencyIds: readonly string[] };
