import type { SearchType } from "./query";

export const RECENT_TYPES = [
  "policy",
  "submission",
  "client",
] as const satisfies readonly SearchType[];

export type RecentType = (typeof RECENT_TYPES)[number];
