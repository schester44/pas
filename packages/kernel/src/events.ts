import type { Instant } from "./dates";
import type { TenantId } from "./tenant";

/** Something that happened in the domain. Persisted to the outbox in the same transaction. */
export interface DomainEvent<Type extends string = string, Payload = unknown> {
  readonly id: string;
  readonly type: Type;
  readonly tenantId: TenantId;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: Instant;
  readonly payload: Payload;
}
