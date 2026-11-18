import type { DomainEvent } from "./events";

/** Base for aggregate roots: collects domain events until the unit of work persists them. */
export abstract class AggregateRoot {
  private pendingEvents: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.pendingEvents.push(event);
  }

  pullEvents(): DomainEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }
}
