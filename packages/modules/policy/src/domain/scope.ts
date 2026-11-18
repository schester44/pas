import type { UserId } from "@pas/kernel";

/**
 * Which policies a caller may see: the tenant's whole book, only those they produced, or (for a
 * client) the policies they're a party to, resolved by the Parties context.
 */
export type PolicyScope =
  | { kind: "tenant" }
  | { kind: "producer"; producerId: UserId }
  | { kind: "party"; policyIds: readonly string[] };
