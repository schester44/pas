import type { Instant, TenantContext, Transaction } from "@pas/kernel";

export interface IntegrationEventRecord {
  id: string;
  installId: string | null;
  providerId: string;
  kind: "health_check" | "configured" | "status" | "delivery" | "webhook" | "error";
  outcome: "ok" | "error";
  summary: string;
  externalId: string | null;
  data: Record<string, unknown>;
  occurredAt: Instant;
}

export interface IntegrationEvents {
  /** Returns false when an event with the same external id was already recorded. */
  add(tx: Transaction, ctx: TenantContext, event: IntegrationEventRecord): Promise<boolean>;
  recent(
    tx: Transaction,
    ctx: TenantContext,
    providerId: string,
    limit: number,
  ): Promise<IntegrationEventRecord[]>;
}
