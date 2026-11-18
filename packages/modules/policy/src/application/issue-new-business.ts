import {
  type Clock,
  invalid,
  jurisdiction,
  Money,
  type Outbox,
  parseInstant,
  parsePlainDate,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import { type NewBusinessLine, Policy } from "../domain/policy";
import { categoryOf } from "../domain/policy-event";
import { formatPolicyNumber } from "../domain/policy-number";
import type { PolicyEventType, TimelineActor } from "../domain/policy-event";
import type { InvoiceIssuer } from "../ports/invoice-issuer";
import type { PolicyRepository } from "../ports/policy-repository";

type MoneyJson = { amount: string; currency: string };

export interface IssueNewBusinessInput {
  quoteId: string;
  submissionId: string;
  productId: string;
  productName: string;
  productReleaseId: string;
  productVersion: string;
  jurisdiction: { country: string; subdivision?: string };
  effectiveDate: string;
  expirationDate: string;
  insuredName: string;
  producer: { id: string; name: string };
  currency: string;
  coverages: { coverage: string; name: string; exposure?: string; premium: MoneyJson }[];
  taxesFees: { code: string; label: string; remitter: string; amount: MoneyJson }[];
  writtenPremium: MoneyJson;
  snapshot: Record<string, unknown>;
  actor: TimelineActor;
  history: {
    type: PolicyEventType;
    occurredAt: string;
    actor: TimelineActor;
    summary: string;
    data: Record<string, unknown>;
  }[];
}

export interface IssuedPolicyDto {
  policyId: string;
  policyNumber: string;
  termId: string;
  transactionId: string;
  invoice: { id: string; number: string; total: MoneyJson };
}

const money = (json: MoneyJson) => Money.of(json.amount, json.currency);

/**
 * Policy, term, NEW_BUSINESS transaction, TermVersion and financial transactions in one unit of
 * work (PLAN §7.2). Idempotent on the quote: binding twice returns the policy already issued.
 */
export function makeIssueNewBusiness(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  policies: PolicyRepository;
  invoices: InvoiceIssuer;
  clock: Clock;
}) {
  return async function issueNewBusiness(
    ctx: TenantContext,
    input: IssueNewBusinessInput,
  ): Promise<IssuedPolicyDto> {
    const written = money(input.writtenPremium);

    const lines: NewBusinessLine[] = [
      ...input.coverages.map((c) => ({
        kind: "written_premium" as const,
        code: c.coverage,
        label: c.name,
        coverage: c.coverage,
        ...(c.exposure && { exposure: c.exposure }),
        amount: money(c.premium),
      })),
      ...input.taxesFees.map((t) => ({
        kind: "tax_fee" as const,
        code: t.code,
        label: t.label,
        remitter: t.remitter,
        amount: money(t.amount),
      })),
    ];

    const coverageTotal = lines
      .filter((line) => line.kind === "written_premium")
      .reduce((sum, line) => sum.plus(line.amount), Money.zero(input.currency));

    if (!coverageTotal.equals(written)) {
      throw invalid("Premium by coverage doesn't add up to the written premium", {
        coverages: coverageTotal.toString(),
        written: written.toString(),
      });
    }

    const taxesAndFees = lines
      .filter((line) => line.kind === "tax_fee")
      .reduce((sum, line) => sum.plus(line.amount), Money.zero(input.currency));

    return deps.uow.run(ctx, async (tx) => {
      const existing = await deps.policies.findByQuote(tx, ctx, input.quoteId);

      const policy =
        existing ??
        Policy.issueNewBusiness(
          {
            tenantId: ctx.tenantId,
            number: formatPolicyNumber(await deps.policies.nextSequence(tx, ctx)),
            productId: input.productId,
            productName: input.productName,
            productReleaseId: input.productReleaseId,
            productVersion: input.productVersion,
            jurisdiction: jurisdiction(input.jurisdiction.country, input.jurisdiction.subdivision),
            effectiveDate: parsePlainDate(input.effectiveDate),
            expirationDate: parsePlainDate(input.expirationDate),
            insuredName: input.insuredName,
            producer: input.producer,
            sourceSubmissionId: input.submissionId,
            sourceQuoteId: input.quoteId,
            writtenPremium: written,
            taxesAndFees,
            lines,
            snapshot: input.snapshot,
            today: deps.clock.today("UTC"),
            actor: input.actor,
            history: input.history.map((entry) => ({
              ...entry,
              category: categoryOf(entry.type),
              occurredAt: parseInstant(entry.occurredAt),
              effectiveDate: null,
              data: { ...entry.data, source: "quote", quoteId: input.quoteId },
            })),
          },
          deps.clock,
        );

      const today = deps.clock.today("UTC").toString();

      const invoice = await deps.invoices.issue(tx, ctx, {
        policyId: policy.id,
        policyNumber: policy.number,
        transactionId: policy.firstTransaction.id,
        currency: input.currency,
        charges: lines.map((line) => ({
          kind: line.kind,
          code: line.code,
          label: line.label,
          ...(line.coverage && { coverage: line.coverage }),
          ...(line.exposure && { exposure: line.exposure }),
          amount: line.amount.toJSON(),
        })),
        issuedOn: today,
        dueOn: today,
      });

      if (!existing) {
        policy.billTransaction(
          policy.firstTransaction.id,
          { ...invoice, total: money(invoice.total) },
          input.actor,
          deps.clock,
        );

        await deps.policies.save(tx, policy);
        await deps.outbox.add(tx, policy.pullEvents());
      }

      return {
        policyId: policy.id,
        policyNumber: policy.number,
        termId: policy.firstTerm.id,
        transactionId: policy.firstTransaction.id,
        invoice: { id: invoice.id, number: invoice.number, total: invoice.total },
      };
    });
  };
}

export type IssueNewBusiness = ReturnType<typeof makeIssueNewBusiness>;
