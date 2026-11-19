import type { PrismaClient } from "@pas/db";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, emailOTP, organization } from "better-auth/plugins";
import { ac, bookReach, DISTRIBUTION_ROLES, roles } from "./permissions";

export interface AuthConfig {
  prisma: PrismaClient;
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  isTrustedTenantOrigin?: (origin: string) => Promise<boolean>;
  /** Delivers a client's one-time sign-in code (PLAN §7.7). */
  sendSignInCode: (input: { email: string; code: string; headers?: Headers }) => Promise<void>;
  /** Links whatever was waiting for this person (an invited producer) once they join a tenant. */
  onInvitationAccepted?: (input: {
    organizationId: string;
    userId: string;
    email: string;
    name: string;
  }) => Promise<void>;
}

/**
 * Better Auth: sessions, email/password, email one-time codes for clients (SSO and API keys come
 * later), organizations = tenants, RBAC with tenant-defined custom roles.
 */
export function createAuth(config: AuthConfig) {
  return betterAuth({
    baseURL: config.baseURL,
    secret: config.secret,
    trustedOrigins: async (request) => {
      const origin = request?.headers.get("origin");

      if (!origin || !config.isTrustedTenantOrigin) return config.trustedOrigins;

      const trusted = await config.isTrustedTenantOrigin(origin);

      return trusted ? [...config.trustedOrigins, origin] : config.trustedOrigins;
    },
    database: prismaAdapter(config.prisma, { provider: "postgresql" }),
    emailAndPassword: { enabled: true },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        dynamicAccessControl: { enabled: true },
        organizationHooks: {
          // Agency admins may invite, but only into distribution roles.
          beforeCreateInvitation: async ({ invitation }) => {
            const inviter = await config.prisma.member.findFirst({
              where: { organizationId: invitation.organizationId, userId: invitation.inviterId },
              select: { role: true },
            });

            const invited = invitation.role.split(",").map((name) => name.trim());

            if (
              bookReach(inviter?.role ?? "") !== "tenant" &&
              invited.some((name) => !DISTRIBUTION_ROLES.includes(name))
            ) {
              throw new APIError("FORBIDDEN", {
                message: "You can only invite agents and agency admins",
              });
            }
          },
          afterAcceptInvitation: async ({ member, user }) => {
            await config.onInvitationAccepted?.({
              organizationId: member.organizationId,
              userId: user.id,
              email: user.email,
              name: user.name,
            });
          },
        },
      }),
      admin(),
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp, type }, ctx) => {
          const headers = ctx?.headers ?? ctx?.request?.headers;

          if (type === "sign-in") {
            await config.sendSignInCode({ email, code: otp, ...(headers && { headers }) });
          }
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
