import { domainEventsQueue } from "./domain-events";

export { domainEventsQueue };

/** Every queue the worker must create at startup. Add new definitions here. */
export const allQueues = [domainEventsQueue] as const;
