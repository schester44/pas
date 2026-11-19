import { z } from "zod";
import { defineQueue } from "../define";

/** One attempt to deliver a public event to a webhook or chat destination; retries are scheduled by the handler. */
export const eventDeliveriesQueue = defineQueue({
  name: "event-deliveries",
  schema: z.object({
    tenantId: z.string(),
    deliveryId: z.string(),
    trigger: z.enum(["automatic", "replay", "test"]),
  }),
  queueOptions: { retryLimit: 3, retryBackoff: true, retryDelay: 10 },
});
