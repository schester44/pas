import type { Transaction } from "@pas/kernel";
import { eventDeliveriesQueue, type QueueClient } from "@pas/queues";
import type { DeliveryJob, DeliveryQueue } from "../ports/delivery-queue";

export class PgBossDeliveryQueue implements DeliveryQueue {
  constructor(private readonly queues: QueueClient) {}

  async enqueue(tx: Transaction, job: DeliveryJob, delay?: Temporal.Duration): Promise<void> {
    await this.queues.sendWithin(tx, eventDeliveriesQueue, job, {
      ...(delay && { startAfter: Math.ceil(delay.total("seconds")) }),
    });
  }
}
