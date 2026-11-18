import { z } from "zod";
import { defineQueue } from "../define";

/**
 * Every domain event lands here. The worker dispatches by `type` to registered handlers.
 * Split hot event types into dedicated queues when volume warrants it.
 */
export const domainEventsQueue = defineQueue({
  name: "domain-events",
  schema: z.object({
    id: z.string(),
    type: z.string(),
    tenantId: z.string(),
    aggregateType: z.string(),
    aggregateId: z.string(),
    occurredAt: z.string(),
    payload: z.unknown(),
  }),
  queueOptions: { retryLimit: 10, retryBackoff: true, retryDelay: 5 },
});
