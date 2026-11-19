import { domainEventsQueue } from "./domain-events";
import { eventDeliveriesQueue } from "./event-deliveries";
import { reconciliationQueue } from "./reconciliation";

export { domainEventsQueue, eventDeliveriesQueue, reconciliationQueue };

/** Every queue the worker must create at startup. Add new definitions here. */
export const allQueues = [domainEventsQueue, eventDeliveriesQueue, reconciliationQueue] as const;
