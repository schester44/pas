import { jurisdictionCode, type TenantContext } from "@pas/kernel";
import type { FeedRecord } from "../domain/feed-files";
import type { FeedSource } from "../ports/services";

const STAFF = { kind: "tenant" } as const;

type Money = { amount: string; currency: string };

/** What feeds read through other contexts' public APIs (catalog releases, policy details). */
export interface CarrierSources {
  products: (ctx: TenantContext) => Promise<{ id: string }[]>;
  releases: (ctx: TenantContext, productId: string) => Promise<{ id: string }[]>;
  release: (
    ctx: TenantContext,
    id: string,
  ) => Promise<{ productId: string; version: string; lifecycle: Record<string, unknown> }>;
  policies: (
    ctx: TenantContext,
    scope: typeof STAFF,
  ) => Promise<{ id: string; productId: string }[]>;
  policy: (
    ctx: TenantContext,
    scope: typeof STAFF,
    id: string,
  ) => Promise<{
    number: string;
    productId: string;
    productName: string;
    productVersion: string;
    insuredName: string;
    expirationDate: string;
    jurisdiction: { country: string; subdivision?: string };
    transactions: {
      id: string;
      type: string;
      status: string;
      effectiveDate: string;
      issuedAt: string | null;
      premiumDelta: Money;
      total: Money;
    }[];
  }>;
}

/** Issued transactions on the products a carrier writes, for its bordereaux and XML feeds. */
export function feedSourceFrom(sources: CarrierSources): FeedSource {
  return {
    records: async (ctx, input) => {
      const written = new Set<string>();

      for (const product of await sources.products(ctx)) {
        for (const listed of await sources.releases(ctx, product.id)) {
          const release = await sources.release(ctx, listed.id);
          const carrier = (release.lifecycle.carrier ?? {}) as { carrier?: string };

          if (carrier.carrier === input.carrierKey)
            written.add(`${release.productId}:${release.version}`);
        }
      }

      const records: FeedRecord[] = [];

      if (written.size === 0) return records;

      for (const summary of await sources.policies(ctx, STAFF)) {
        if (![...written].some((w) => w.startsWith(`${summary.productId}:`))) continue;

        const policy = await sources.policy(ctx, STAFF, summary.id);

        if (!written.has(`${policy.productId}:${policy.productVersion}`)) continue;

        for (const t of policy.transactions) {
          const issuedOn = t.issuedAt?.slice(0, 10);

          if (t.status !== "issued" || !issuedOn || issuedOn < input.from || issuedOn > input.to)
            continue;

          records.push({
            policyNumber: policy.number,
            carrierPolicyNumber: null,
            transactionType: t.type,
            transactionId: t.id,
            effectiveDate: t.effectiveDate,
            issuedOn,
            expirationDate: policy.expirationDate,
            insuredName: policy.insuredName,
            jurisdiction: jurisdictionCode(policy.jurisdiction),
            product: `${policy.productName} ${policy.productVersion}`,
            premiumChange: t.premiumDelta.amount,
            taxesFees: (Number(t.total.amount) - Number(t.premiumDelta.amount)).toFixed(2),
            currency: t.total.currency,
          });
        }
      }

      return records.toSorted(
        (a, b) =>
          a.issuedOn.localeCompare(b.issuedOn) || a.policyNumber.localeCompare(b.policyNumber),
      );
    },
  };
}
