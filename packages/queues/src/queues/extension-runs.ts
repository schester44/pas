import { z } from "zod";
import { defineQueue } from "../define";

/** Deletes extension runs older than the retention period (PLAN §15.1). */
export const extensionRunRetentionQueue = defineQueue({
  name: "extension-run-retention",
  schema: z.object({ days: z.number().int().min(1).max(3660) }),
  queueOptions: { retryLimit: 2, retryBackoff: true, retryDelay: 300 },
});
