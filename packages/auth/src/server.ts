import type { PrismaClient } from "@pas/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, organization } from "better-auth/plugins";
import { ac, roles } from "./permissions";

export interface AuthConfig {
  prisma: PrismaClient;
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
}

/**
 * Better Auth: sessions, email/password (SSO, magic links and API keys come later),
 * organizations = tenants, RBAC with tenant-defined custom roles.
 */
export function createAuth(config: AuthConfig) {
  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: config.trustedOrigins,
    database: prismaAdapter(config.prisma, { provider: "postgresql" }),
    emailAndPassword: { enabled: true },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        dynamicAccessControl: { enabled: true },
      }),
      admin(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
