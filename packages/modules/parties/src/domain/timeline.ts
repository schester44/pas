const CLIENT_CATEGORIES: ReadonlySet<string> = new Set([
  "transactional",
  "lifecycle",
  "billing",
  "document",
  "communication",
  "service",
]);

/** What a policyholder sees of the timeline: no underwriting, notes or pre-bind quoting. */
export function isClientVisibleEvent(event: { type: string; category: string }): boolean {
  return CLIENT_CATEGORIES.has(event.category) && event.type !== "quoted";
}
