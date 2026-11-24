import { type Id, type Instant, invalid, type TenantId } from "@pas/kernel";
import type { ExtensionId } from "./extension";
import type { ExtensionVersionId } from "./version";

export type SubscriptionId = Id<"ExtensionSubscription">;

/** Runs an automation extension version when one of its event types happens (PLAN §15.6). */
export interface AutomationSubscription {
  id: SubscriptionId;
  tenantId: TenantId;
  extensionId: ExtensionId;
  extensionVersionId: ExtensionVersionId;
  eventTypes: string[];
  /** A ZEN expression over `event`; the automation runs only when it's true. */
  condition: string | null;
  enabled: boolean;
  createdAt: Instant;
  updatedAt: Instant;
}

const EVENT_TYPE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function checkEventTypes(eventTypes: readonly string[]): string[] {
  const types = [...new Set(eventTypes.map((t) => t.trim()).filter(Boolean))];

  if (types.length === 0) throw invalid("Choose at least one event", { field: "eventTypes" });

  const bad = types.find((t) => !EVENT_TYPE.test(t));

  if (bad)
    throw invalid(`${bad} isn't an event type like policy.term_bound`, { field: "eventTypes" });

  return types;
}
