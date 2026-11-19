import { evaluate, ExpressionError, validate } from "@pas/expressions";
import { invalid } from "@pas/kernel";
import { PUBLIC_EVENT_TYPES } from "./event-types";

/** `*` matches everything, `policy.*` a whole group, anything else one exact type. */
export function matchesPattern(pattern: string, type: string): boolean {
  if (pattern === "*") return true;

  if (pattern.endsWith(".*")) return type.startsWith(pattern.slice(0, -1));

  return pattern === type;
}

export function assertPatterns(patterns: readonly string[]): void {
  if (patterns.length === 0) throw invalid("Choose at least one event type");

  for (const pattern of patterns) {
    if (!PUBLIC_EVENT_TYPES.some((type) => matchesPattern(pattern, type))) {
      throw invalid(`${pattern} doesn't match any event type`, { pattern });
    }
  }
}

export function assertFilter(filter: string | null): void {
  if (filter === null) return;

  const check = validate(filter);

  if (!check.ok) throw invalid(`The filter doesn't parse: ${check.message}`, { filter });
}

export interface Matchable {
  type: string;
  /** What filters see: `product`, `premium`, `jurisdiction`, `producer` and the full `data`. */
  facets: Record<string, unknown>;
}

export interface Subscriber {
  status: "active" | "disabled";
  eventTypes: readonly string[];
  filter: string | null;
}

/** A filter that fails at runtime (a missing field, a type mismatch) doesn't match. */
export function subscriptionMatches(subscriber: Subscriber, event: Matchable): boolean {
  if (subscriber.status !== "active") return false;

  if (!subscriber.eventTypes.some((pattern) => matchesPattern(pattern, event.type))) return false;

  if (!subscriber.filter) return true;

  try {
    return evaluate(subscriber.filter, { type: event.type, ...event.facets }) === true;
  } catch (error) {
    if (error instanceof ExpressionError) return false;

    throw error;
  }
}
