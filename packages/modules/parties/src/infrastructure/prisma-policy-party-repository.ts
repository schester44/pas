import { prismaTx } from "@pas/db";
import { newId, type TenantContext, type Transaction } from "@pas/kernel";
import type { PartyRole } from "../domain/client-scope";
import type { PolicyPartyLink, PolicyPartyRepository } from "../ports/policy-party-repository";

const select = { policyId: true, policyNumber: true, clientAccountId: true, role: true } as const;

const toLink = (row: {
  policyId: string;
  policyNumber: string;
  clientAccountId: string;
  role: string;
}) => ({ ...row, role: row.role as PartyRole }) satisfies PolicyPartyLink;

export class PrismaPolicyPartyRepository implements PolicyPartyRepository {
  async link(tx: Transaction, ctx: TenantContext, link: PolicyPartyLink): Promise<void> {
    await prismaTx(tx).policyParty.createMany({
      data: [{ id: newId(), tenantId: ctx.tenantId, ...link, createdAt: new Date() }],
      skipDuplicates: true,
    });
  }

  async listByPolicy(tx: Transaction, ctx: TenantContext, policyId: string) {
    const rows = await prismaTx(tx).policyParty.findMany({
      where: { tenantId: ctx.tenantId, policyId },
      orderBy: { createdAt: "asc" },
      select,
    });

    return rows.map(toLink);
  }

  async listByAccounts(tx: Transaction, ctx: TenantContext, accountIds: readonly string[]) {
    if (accountIds.length === 0) return [];

    const rows = await prismaTx(tx).policyParty.findMany({
      where: { tenantId: ctx.tenantId, clientAccountId: { in: [...accountIds] } },
      orderBy: { createdAt: "asc" },
      select,
    });

    return rows.map(toLink);
  }

  async findByPolicyNumber(tx: Transaction, ctx: TenantContext, policyNumber: string) {
    const rows = await prismaTx(tx).policyParty.findMany({
      where: { tenantId: ctx.tenantId, policyNumber },
      select,
    });

    return rows.map(toLink);
  }

  async moveAccount(tx: Transaction, ctx: TenantContext, from: string, to: string): Promise<void> {
    const db = prismaTx(tx);

    const moving = await db.policyParty.findMany({
      where: { tenantId: ctx.tenantId, clientAccountId: from },
      select,
    });

    if (moving.length > 0) {
      await db.policyParty.createMany({
        data: moving.map((link) => ({
          id: newId(),
          tenantId: ctx.tenantId,
          ...link,
          clientAccountId: to,
          createdAt: new Date(),
        })),
        skipDuplicates: true,
      });
    }

    await db.policyParty.deleteMany({ where: { tenantId: ctx.tenantId, clientAccountId: from } });
  }
}
