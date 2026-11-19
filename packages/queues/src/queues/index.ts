import { domainEventsQueue } from "./domain-events";
import { eventDeliveriesQueue } from "./event-deliveries";

export { domainEventsQueue, eventDeliveriesQueue };

/** Every queue the worker must create at startup. Add new definitions here. */
export const allQueues = [domainEventsQueue, eventDeliveriesQueue] as const;
