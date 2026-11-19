import type { BookScope } from "@pas/kernel";

/**
 * Which policies a caller may see: a book (the tenant's, their agencies' or their own, PLAN §5.7),
 * or for a client the policies they're a party to, resolved by the Parties context.
 */
export type PolicyScope = BookScope | { kind: "party"; policyIds: readonly string[] };
