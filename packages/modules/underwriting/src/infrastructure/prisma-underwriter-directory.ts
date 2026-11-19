import type { PrismaClient } from "@pas/db";
import type { TenantContext } from "@pas/kernel";
import type { StaffMember, UnderwriterDirectory } from "../ports/underwriters";

const select = { role: true, user: { select: { id: true, name: true, email: true } } } as const;

type Row = { role: string; user: { id: string; name: string; email: string } };

const toMember = (row: Row): StaffMember => ({
  userId: row.user.id,
  name: row.user.name,
  email: row.user.email,
  roles: row.role.split(",").map((r) => r.trim()),
});

/** Members are Better Auth rows; only id, name, email and roles leave here. */
export class PrismaUnderwriterDirectory implements UnderwriterDirectory {
  constructor(private readonly prisma: PrismaClient) {}

  async member(ctx: TenantContext, userId: string) {
    const row = await this.prisma.member.findFirst({
      where: { organizationId: ctx.tenantId, userId },
      select,
    });

    return row && toMember(row);
  }

  async list(ctx: TenantContext) {
    const rows = await this.prisma.member.findMany({
      where: { organizationId: ctx.tenantId },
      select,
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toMember);
  }
}
