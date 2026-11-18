import type { QueueOptions, SendOptions } from "pg-boss";
import type { z } from "zod";

/**
 * A typed queue: name + zod payload schema + defaults. Producers and the worker import the same
 * definition, so payloads are validated on both ends.
 */
export interface QueueDefinition<Schema extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly schema: Schema;
  readonly queueOptions?: QueueOptions;
  readonly sendOptions?: SendOptions;
}

export function defineQueue<Schema extends z.ZodType>(
  definition: QueueDefinition<Schema>,
): QueueDefinition<Schema> {
  return definition;
}

export type QueuePayload<Q extends QueueDefinition> = z.infer<Q["schema"]>;
