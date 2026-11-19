import type { BookScope } from "@pas/kernel";

/** Which submissions a caller may see: the tenant's book, their agencies' or their own (PLAN §5.7). */
export type SubmissionScope = BookScope;
