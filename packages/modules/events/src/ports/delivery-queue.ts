import type { Transaction } from "@pas/kernel";
import type { AttemptTrigger } from "../domain/delivery";

export interface DeliveryJob {
  tenantId: string;
  deliveryId: string;
  trigger: AttemptTrigger;
}

/** Enqueues a delivery attempt inside the caller's transaction, optionally after a wait. */
export interface DeliveryQueue {
  enqueue(tx: Transaction, job: DeliveryJob, delay?: Temporal.Duration): Promise<void>;
}
