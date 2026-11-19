import { prismaTx } from "@pas/db";
import type { AddressUsage as Row } from "@pas/db/client";
import { newId, type TenantContext, type Transaction } from "@pas/kernel";
import type { AddressUsage, SubjectKind, SubjectRef, UsageRole } from "../domain/clearance";
import type { AddressUsages } from "../ports/address-usages";

const toUsage = (row: Row): AddressUsage => ({
  addressId: row.addressId,
  subject: { kind: row.subjectKind as SubjectKind, id: row.subjectId },
  label: row.subjectLabel,
  role: row.role as UsageRole,
  productId: row.productId,
  producer: row.producerId ? { id: row.producerId, name: row.producerName ?? "" } : null,
  active: row.active,
});

const bySubject = (ctx: TenantContext, subject: SubjectRef) => ({
  tenantId: ctx.tenantId,
  subjectKind: subject.kind,
  subjectId: subject.id,
});

export class PrismaAddressUsages implements AddressUsages {
  async replace(
    tx: Transaction,
    ctx: TenantContext,
    subject: SubjectRef,
    roles: readonly UsageRole[],
    usages: readonly AddressUsage[],
  ) {
    const db = prismaTx(tx);
    const now = new Date();

    await db.addressUsage.deleteMany({
      where: { ...bySubject(ctx, subject), role: { in: [...roles] } },
    });

    if (usages.length === 0) return;

    await db.addressUsage.createMany({
      data: usages.map((u) => ({
        id: newId(),
        ...bySubject(ctx, subject),
        addressId: u.addressId,
        subjectLabel: u.label,
        role: u.role,
        productId: u.productId,
        producerId: u.producer?.id ?? null,
        producerName: u.producer?.name ?? null,
        active: u.active,
        createdAt: now,
        updatedAt: now,
      })),
      skipDuplicates: true,
    });
  }

  async setActive(tx: Transaction, ctx: TenantContext, subject: SubjectRef, active: boolean) {
    await prismaTx(tx).addressUsage.updateMany({
      where: bySubject(ctx, subject),
      data: { active, updatedAt: new Date() },
    });
  }

  async listBySubject(tx: Transaction, ctx: TenantContext, subject: SubjectRef) {
    const rows = await prismaTx(tx).addressUsage.findMany({ where: bySubject(ctx, subject) });

    return rows.map(toUsage);
  }

  async listActiveByAddresses(tx: Transaction, ctx: TenantContext, addressIds: readonly string[]) {
    if (addressIds.length === 0) return [];

    const rows = await prismaTx(tx).addressUsage.findMany({
      where: { tenantId: ctx.tenantId, addressId: { in: [...addressIds] }, active: true },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toUsage);
  }
}
