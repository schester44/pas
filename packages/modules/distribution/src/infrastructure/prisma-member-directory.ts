import type { PrismaClient } from "@pas/db";
import type { TenantContext } from "@pas/kernel";
import type { MemberDirectory } from "../ports/member-directory";

/** Members are Better Auth rows (Identity is the store); only name, id and role leave here. */
export class PrismaMemberDirectory implements MemberDirectory {
  constructor(private readonly prisma: PrismaClient) {}

  async findByEmail(ctx: TenantContext, email: string) {
    const member = await this.prisma.member.findFirst({
      where: { organizationId: ctx.tenantId, user: { email: email.toLowerCase() } },
      select: { role: true, user: { select: { id: true, name: true } } },
    });

    return member && { userId: member.user.id, name: member.user.name, role: member.role };
  }
}
