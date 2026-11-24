import { domainEventsQueue } from "./domain-events";
import { eventDeliveriesQueue } from "./event-deliveries";
import { extensionRunRetentionQueue } from "./extension-runs";
import { reconciliationQueue } from "./reconciliation";

export { domainEventsQueue, eventDeliveriesQueue, extensionRunRetentionQueue, reconciliationQueue };

/** Every queue the worker must create at startup. Add new definitions here. */
export const allQueues = [
  domainEventsQueue,
  eventDeliveriesQueue,
  extensionRunRetentionQueue,
  reconciliationQueue,
] as const;
