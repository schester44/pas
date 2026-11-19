export { makeSearch, type Search } from "./application/search";
export type { SearchHit } from "./domain/hit";
export { classifyQuery, SEARCH_TYPES, type SearchQuery, type SearchType } from "./domain/query";
export type { SearchScope } from "./domain/scope";
export type { SearchIndex } from "./ports/search-index";
export { makeRecentViews, type RecentViews } from "./application/recent-views";
export { RECENT_TYPES, type RecentType } from "./domain/recent";
export type { RecentViewRepository } from "./ports/recent-views";
