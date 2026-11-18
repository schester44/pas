import type { UserId } from "@pas/kernel";

/** Which policies a caller may see: the tenant's whole book, or only those they produced. */
export type PolicyScope = { kind: "tenant" } | { kind: "producer"; producerId: UserId };
