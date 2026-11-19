import type { PrismaClient } from "@pas/db";
import type { TenantContext } from "@pas/kernel";
import type { Audience } from "../domain/event-types";
import type { TenantMember, TenantMembers } from "../ports/platform";

/** The tenant's members from the identity tables; roles are classified by the composition root. */
export class PrismaTenantMembers implements TenantMembers {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly classify: (role: string) => { audience: Audience | null; admin: boolean },
  ) {}

  async list(ctx: TenantContext): Promise<TenantMember[]> {
    const members = await this.prisma.member.findMany({
      where: { organizationId: ctx.tenantId },
      select: { role: true, user: { select: { id: true, name: true, email: true } } },
    });

    return members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      ...this.classify(m.role),
    }));
  }
}
