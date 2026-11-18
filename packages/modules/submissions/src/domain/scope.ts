import type { UserId } from "@pas/kernel";

/** Which submissions a caller may see: the whole tenant's book, or only those they produced. */
export type SubmissionScope = { kind: "tenant" } | { kind: "producer"; producerId: UserId };
