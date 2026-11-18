import type { TenantContext, Transaction, UnitOfWork } from "@pas/kernel";
import type { Prisma, PrismaClient } from "./client";

export type PrismaTx = Prisma.TransactionClient;

/** Adapters use this to turn the kernel's opaque Transaction back into a Prisma client. */
export function prismaTx(tx: Transaction): PrismaTx {
  return tx as unknown as PrismaTx;
}

/**
 * Interactive transaction scoped to a tenant. `app.tenant_id` is set transaction-locally so
 * Postgres row-level security policies can enforce isolation as defense in depth.
 * Domain events are enqueued in this same transaction by the Outbox adapter (@pas/queues).
 */
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  run<T>(ctx: TenantContext, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`select set_config('app.tenant_id', ${ctx.tenantId}, true)`;
      return work(tx as unknown as Transaction);
    });
  }
}
