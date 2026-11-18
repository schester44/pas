import type { UserId } from "@pas/kernel";

/** Same rule as the submission and policy lists: the tenant's whole book, or only what one producer wrote. */
export type SearchScope = { kind: "tenant" } | { kind: "producer"; producerId: UserId };
