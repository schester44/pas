import type { Logger } from "@pas/observability";
import type { QueuePayload, domainEventsQueue } from "@pas/queues";

export type DomainEventMessage = QueuePayload<typeof domainEventsQueue>;
export type DomainEventHandler = (event: DomainEventMessage) => Promise<void>;

/**
 * Routes domain events by type to handlers. Handlers must be idempotent on `event.id`
 * (delivery is at-least-once). Register handlers in index.ts.
 */
export function createDomainEventDispatcher(
  handlers: Record<string, DomainEventHandler[]>,
  logger: Logger,
) {
  return async (event: DomainEventMessage) => {
    const matched = handlers[event.type] ?? [];
    if (matched.length === 0) {
      logger.debug({ type: event.type, id: event.id }, "domain event has no handlers");
      return;
    }
    for (const handler of matched) await handler(event);
  };
}
