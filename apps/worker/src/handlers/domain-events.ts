import type { Logger } from "@pas/observability";
import type { QueuePayload, domainEventsQueue } from "@pas/queues";

export type DomainEventMessage = QueuePayload<typeof domainEventsQueue>;
export type DomainEventHandler = (event: DomainEventMessage) => Promise<void>;

export class UnknownDomainEvent extends Error {
  constructor(type: string) {
    super(`Domain event ${type} is unknown to this worker; leaving it for a newer one`);
  }
}

/**
 * Routes domain events by type to handlers. Handlers must be idempotent on `event.id`
 * (delivery is at-least-once). Register handlers in index.ts; `*` handlers see every event.
 * Types neither handled nor in `known` fail, so the queue retries them on a newer worker.
 */
export function createDomainEventDispatcher(
  handlers: Record<string, DomainEventHandler[]>,
  known: readonly string[],
  logger: Logger,
) {
  const registry = new Set([...known, ...Object.keys(handlers).filter((type) => type !== "*")]);

  return async (event: DomainEventMessage) => {
    if (!registry.has(event.type)) {
      logger.warn({ type: event.type, id: event.id }, "unknown domain event; retrying later");

      throw new UnknownDomainEvent(event.type);
    }

    const matched = [...(handlers[event.type] ?? []), ...(handlers["*"] ?? [])];

    for (const handler of matched) await handler(event);
  };
}
