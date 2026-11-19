import { z } from "zod";
import { defineQueue } from "../define";

/** Re-derives what issued transactions should have produced (obligations, commissions). */
export const reconciliationQueue = defineQueue({
  name: "reconciliation",
  schema: z.object({
    tenantId: z.string().nullable(),
    days: z.number().int().min(1).max(3660),
  }),
  queueOptions: { retryLimit: 2, retryBackoff: true, retryDelay: 60 },
});
