import { makeGetProduct } from "@pas/catalog";
import { PrismaProductRepository } from "@pas/catalog/infrastructure";
import type { EventSubjects, PolicySnapshot } from "@pas/events";
import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { ListInvoices } from "@pas/billing";
import type { Compliance } from "@pas/compliance/infrastructure";
import type { GetPolicy } from "@pas/policy";
import type { GetQuote, GetSubmission } from "@pas/submissions";

const TENANT = { kind: "tenant" } as const;

const orNull = <T>(promise: Promise<T>): Promise<T | null> => promise.catch(() => null);

/** Compact public snapshots built from each context's own read use cases (PLAN §15.8). */
export function makeEventSubjects(deps: {
  uow: UnitOfWork;
  submissions: GetSubmission;
  quotes: GetQuote;
  policies: GetPolicy;
  invoices: ListInvoices;
  compliance: Compliance;
}): EventSubjects {
  const getProduct = makeGetProduct({ uow: deps.uow, products: new PrismaProductRepository() });

  const product = async (ctx: TenantContext, id: string, name: string) => {
    const found = await orNull(getProduct(ctx, { id }));

    return { id, key: found?.key ?? id, name: found?.name ?? name };
  };

  return {
    async submission(ctx, id) {
      const s = await orNull(deps.submissions(ctx, TENANT, { id }));

      if (!s) return null;

      const q = await orNull(deps.quotes.forProducer(ctx, TENANT, { submissionId: id }));

      return {
        submission: {
          id: s.id,
          number: s.number,
          status: s.status,
          product: await product(ctx, s.productId, s.productName),
          jurisdiction: {
            country: s.jurisdiction.country,
            subdivision: s.jurisdiction.subdivision ?? null,
          },
          effectiveDate: s.effectiveDate,
          insuredName: s.insuredName,
          producer: s.producer,
        },
        quote: q && {
          id: q.id,
          status: q.status,
          premium: { written: q.premium.written, total: q.premium.total },
          expiresAt: q.expiresAt,
          referralReasons: (q.referral?.reasons ?? []).map((r) => ({
            code: r.reasonCode,
            message: r.message,
          })),
        },
      };
    },

    async policy(ctx, id): Promise<PolicySnapshot | null> {
      const p = await orNull(deps.policies.detail(ctx, TENANT, { id }));

      return (
        p && {
          id: p.id,
          number: p.number,
          status: p.status,
          product: await product(ctx, p.productId, p.productName),
          jurisdiction: {
            country: p.jurisdiction.country,
            subdivision: p.jurisdiction.subdivision ?? null,
          },
          insuredName: p.insuredName,
          producer: { id: p.producerId, name: p.producerName },
          agency: p.agencyId ? { id: p.agencyId, name: p.producerAgency ?? "" } : null,
          effectiveDate: p.effectiveDate,
          expirationDate: p.expirationDate,
          writtenPremium: p.writtenPremium,
          total: p.total,
        }
      );
    },

    async invoice(ctx, id) {
      const i = await orNull(deps.invoices.byId(ctx, { id }));

      return (
        i && {
          id: i.id,
          number: i.number,
          kind: i.kind,
          status: i.status,
          issuedOn: i.issuedOn,
          dueOn: i.dueOn,
          total: i.total,
          balance: i.balance,
          installment: i.installments > 1 ? { number: i.installment, of: i.installments } : null,
        }
      );
    },

    async obligation(ctx, id) {
      const o = await orNull(deps.compliance.obligation.detail(ctx, { id }));

      return (
        o && {
          id: o.id,
          kind: o.kind,
          title: o.title,
          status: o.status,
          jurisdiction: o.jurisdiction,
          dueDate: o.dueDate,
          policy:
            o.subject.policyId && o.subject.policyNumber
              ? { id: o.subject.policyId, number: o.subject.policyNumber }
              : null,
        }
      );
    },
  };
}
