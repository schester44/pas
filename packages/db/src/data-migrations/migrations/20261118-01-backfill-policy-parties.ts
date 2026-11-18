import { newId } from "@pas/kernel";
import type { Prisma } from "../../generated/prisma/client";
import { migration } from "../types";

type Address = Prisma.InputJsonObject;

interface Snapshot {
  risk?: { insured?: Record<string, unknown>; mailingAddress?: Address };
  parties?: { namedInsureds?: string[]; mailingAddress?: Address | null };
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const words = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const nameKey = (name: string) => words(name).toSorted().join(" ");

const emailKey = (email: string) => {
  const value = email.trim().toLowerCase();

  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? value : null;
};

/**
 * Policies bound before the Parties context existed get client accounts and named-insured links,
 * matched by email (else by name) within the tenant. No invites are sent; producers can resend.
 * Phone and address keys are left for the account's next save, which recomputes every key.
 */
export default migration({
  name: "20261118-01-backfill-policy-parties",
  async up({ db }) {
    const linked = new Set(
      (await db.policyParty.findMany({ select: { policyId: true } })).map((l) => l.policyId),
    );

    const policies = (await db.policy.findMany({ orderBy: { createdAt: "asc" } })).filter(
      (p) => !linked.has(p.id),
    );

    for (const policy of policies) {
      const term = await db.policyTerm.findFirst({
        where: { policyId: policy.id },
        orderBy: { termNumber: "asc" },
      });

      const version =
        term &&
        (await db.termVersion.findFirst({
          where: { termId: term.id },
          orderBy: { version: "desc" },
        }));

      const snapshot = (version?.snapshot ?? {}) as Snapshot;
      const insured = snapshot.risk?.insured ?? {};
      const names = (snapshot.parties?.namedInsureds ?? []).map(text).filter(Boolean);
      const primary = names[0] ?? policy.insuredName;
      const email = text(insured.email);
      const key = email ? emailKey(email) : null;
      const address = snapshot.parties?.mailingAddress ?? snapshot.risk?.mailingAddress ?? null;
      const businessName = text(insured.businessName);
      const kind = businessName ? "business" : "person";
      const now = new Date();

      const existing = await db.clientAccount.findFirst({
        where: {
          tenantId: policy.tenantId,
          status: "active",
          kind,
          ...(key
            ? { emailKeys: { has: key } }
            : { nameKey: nameKey(primary), emailKeys: { isEmpty: true } }),
        },
        orderBy: { createdAt: "asc" },
      });

      const accountId = existing?.id ?? newId();

      if (!existing) {
        await db.clientAccount.create({
          data: {
            id: accountId,
            tenantId: policy.tenantId,
            kind,
            displayName: primary,
            firstName: text(insured.firstName) || null,
            lastName: text(insured.lastName) || null,
            businessName: businessName || null,
            emails: key ? [{ address: email, key, verifiedAt: null }] : [],
            phones: [],
            ...(address && { mailingAddress: address }),
            nameKey: nameKey(primary),
            emailKeys: key ? [key] : [],
            phoneKeys: [],
            addressKey: null,
            status: "active",
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      await db.policyParty.create({
        data: {
          id: newId(),
          tenantId: policy.tenantId,
          policyId: policy.id,
          policyNumber: policy.number,
          clientAccountId: accountId,
          role: "named_insured",
          createdAt: now,
        },
      });
    }
  },
});
