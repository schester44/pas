import { roles } from "@pas/auth";
import type { PrismaClient } from "@pas/db";

const grantsUpdate = (permission: Record<string, readonly string[]> | undefined) =>
  permission?.organization?.includes("update") ?? false;

/** Members whose role (built-in or tenant-defined) grants `organization:update` may enter sandboxes. */
export function sandboxAccess(prisma: PrismaClient) {
  return async (memberRole: string, organizationId: string): Promise<boolean> => {
    for (const role of memberRole.split(",").map((r) => r.trim())) {
      const builtIn = roles[role as keyof typeof roles];

      if (builtIn && grantsUpdate(builtIn.statements as Record<string, readonly string[]>))
        return true;

      const custom = await prisma.organizationRole.findFirst({
        where: { organizationId, role },
        select: { permission: true },
      });

      if (custom && grantsUpdate(JSON.parse(custom.permission))) return true;
    }

    return false;
  };
}
