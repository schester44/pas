import { instantFromDb, instantToDb, prismaTx } from "@pas/db";
import type { Prisma } from "@pas/db/client";
import type { TenantContext, Transaction } from "@pas/kernel";
import type { ChangeRequestProps } from "../domain/change-request";
import type { ChangeRequestRepository } from "../ports/change-request-repository";

export class PrismaChangeRequestRepository implements ChangeRequestRepository {
  async add(tx: Transaction, ctx: TenantContext, request: ChangeRequestProps): Promise<void> {
    await prismaTx(tx).changeRequest.create({
      data: {
        id: request.id,
        tenantId: ctx.tenantId,
        policyId: request.policyId,
        kind: request.kind,
        details: request.details,
        status: request.status,
        requestedBy: request.requestedBy as unknown as Prisma.InputJsonValue,
        producerId: request.producerId,
        createdAt: instantToDb(request.createdAt),
      },
    });
  }

  async listByPolicy(
    tx: Transaction,
    ctx: TenantContext,
    policyId: string,
  ): Promise<ChangeRequestProps[]> {
    const rows = await prismaTx(tx).changeRequest.findMany({
      where: { tenantId: ctx.tenantId, policyId },
      orderBy: { createdAt: "desc" },
    });

    return rows.map((row) => ({
      id: row.id,
      policyId: row.policyId,
      kind: row.kind,
      details: row.details,
      status: row.status as ChangeRequestProps["status"],
      requestedBy: row.requestedBy as unknown as ChangeRequestProps["requestedBy"],
      producerId: row.producerId,
      createdAt: instantFromDb(row.createdAt),
    }));
  }
}
