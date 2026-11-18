import type { PrismaClient } from "@pas/db";
import { newId, notFound, type TenantContext } from "@pas/kernel";
import type { OrganizationRef } from "../domain/tenant-profile";
import type { SandboxOrganizations } from "../ports/sandbox";
import { toOrganizationRef } from "./mappers";

/** Organizations are Better Auth's tables; sandbox members are the parent's members `mayEnter` admits. */
export class PrismaSandboxOrganizations implements SandboxOrganizations {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly mayEnter: (role: string, organizationId: string) => Promise<boolean>,
  ) {}

  async create(parent: TenantContext, name: string): Promise<OrganizationRef> {
    const source = await this.prisma.organization.findUnique({
      where: { id: parent.tenantId },
      include: { members: true },
    });

    if (!source) throw notFound("Organization", parent.tenantId);

    const members = [];

    for (const member of source.members) {
      const isActor = parent.actor.type === "user" && parent.actor.userId === member.userId;

      if (isActor || (await this.mayEnter(member.role, source.id))) members.push(member);
    }

    const slug = await this.freeSlug(`${source.slug}-sandbox`);
    const now = new Date();

    const org = await this.prisma.organization.create({
      data: {
        id: newId(),
        name: name || `${source.name} Sandbox`,
        slug,
        metadata: JSON.stringify({ environment: "sandbox", parentTenantId: source.id }),
        createdAt: now,
        members: {
          create: members.map((m) => ({
            id: newId(),
            userId: m.userId,
            role: m.role,
            createdAt: now,
          })),
        },
      },
      select: { id: true, name: true, slug: true, createdAt: true },
    });

    return toOrganizationRef(org);
  }

  private async freeSlug(base: string): Promise<string> {
    for (let n = 1; ; n++) {
      const slug = n === 1 ? base : `${base}-${n}`;

      if (!(await this.prisma.organization.findUnique({ where: { slug }, select: { id: true } })))
        return slug;
    }
  }
}
