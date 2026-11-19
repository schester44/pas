import { prismaTx } from "@pas/db";
import { Prisma, type QuoteStatus as DbQuoteStatus, type Quote as QuoteRow } from "@pas/db/client";
import { asId, Money, type TenantContext, type Transaction } from "@pas/kernel";
import type { BindDetails } from "../domain/bind-details";
import type { CoverageChoice } from "../domain/coverages";
import {
  type PaymentRecord,
  Quote,
  type QuoteId,
  type QuoteStatus,
  type Referral,
  type SignatureRecord,
} from "../domain/quote";
import type { QuoteActivity } from "../domain/quote-activity";
import type { QuoteEvaluation } from "../domain/quote-evaluation";
import type { SubmissionId } from "../domain/submission";
import type { PaymentAttempt, QuoteRepository } from "../ports/quote-repository";

type MoneyJson = { amount: string; currency: string };
type Json = Prisma.InputJsonValue;

const toDb = (s: QuoteStatus) => s.toUpperCase() as DbQuoteStatus;
const fromDb = (s: DbQuoteStatus) => s.toLowerCase() as QuoteStatus;
const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
const toInstant = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());
const instant = (value: string) => Temporal.Instant.from(value);
const plainDateToDb = (d: Temporal.PlainDate) => new Date(`${d.toString()}T00:00:00Z`);
const plainDateFromDb = (d: Date) => Temporal.PlainDate.from(d.toISOString().slice(0, 10));
const money = (json: MoneyJson) => Money.of(json.amount, json.currency);
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json;

type EvaluationJson = Omit<
  QuoteEvaluation,
  "premium" | "writtenPremium" | "taxesFees" | "total" | "evaluatedAt"
> & {
  premium: (Omit<QuoteEvaluation["premium"][number], "premium"> & { premium: MoneyJson })[];
  writtenPremium: MoneyJson;
  taxesFees: (Omit<QuoteEvaluation["taxesFees"][number], "amount"> & { amount: MoneyJson })[];
  total: MoneyJson;
  evaluatedAt: string;
};

function evaluationFromJson(value: EvaluationJson): QuoteEvaluation {
  return {
    ...value,
    premium: value.premium.map((line) => ({ ...line, premium: money(line.premium) })),
    writtenPremium: money(value.writtenPremium),
    taxesFees: value.taxesFees.map((line) => ({ ...line, amount: money(line.amount) })),
    total: money(value.total),
    evaluatedAt: instant(value.evaluatedAt),
    payPlans: value.payPlans ?? [],
  };
}

interface ReferralJson {
  reasons: Referral["reasons"];
  referredAt: string;
  reviewBy: string;
  approvedReasonCodes: string[];
  decision: (Omit<NonNullable<Referral["decision"]>, "decidedAt"> & { decidedAt: string }) | null;
}

function referralFromJson(value: ReferralJson): Referral | null {
  if (!value.referredAt) return null;

  return {
    reasons: value.reasons,
    referredAt: instant(value.referredAt),
    reviewBy: instant(value.reviewBy),
    decision: value.decision && { ...value.decision, decidedAt: instant(value.decision.decidedAt) },
  };
}

type SignatureJson = Omit<SignatureRecord, "signedAt"> & { signedAt: string };
type PaymentJson = Omit<PaymentRecord, "amount" | "capturedAt"> & {
  amount: MoneyJson;
  capturedAt: string;
};

export class PrismaQuoteRepository implements QuoteRepository {
  async save(tx: Transaction, quote: Quote): Promise<void> {
    const q = quote.toSnapshot();

    const referral: ReferralJson | null =
      q.referral || q.approvedReasonCodes.length > 0
        ? {
            reasons: q.referral?.reasons ?? [],
            referredAt: q.referral?.referredAt.toString() ?? "",
            reviewBy: q.referral?.reviewBy.toString() ?? "",
            approvedReasonCodes: q.approvedReasonCodes,
            decision: q.referral?.decision
              ? { ...q.referral.decision, decidedAt: q.referral.decision.decidedAt.toString() }
              : null,
          }
        : null;

    const data = {
      revision: q.revision,
      status: toDb(q.status),
      currency: q.evaluation.total.currency,
      premium: q.evaluation.writtenPremium.toString(),
      taxesAndFees: q.evaluation.total.minus(q.evaluation.writtenPremium).toString(),
      total: q.evaluation.total.toString(),
      selection: json(q.selection),
      evaluation: json(q.evaluation),
      referral: referral ? json(referral) : DbNull,
      details: q.details ? json(q.details) : DbNull,
      signature: q.signature ? json(q.signature) : DbNull,
      payment: q.payment ? json(q.payment) : DbNull,
      payPlan: q.payPlan,
      policyId: q.policy?.id ?? null,
      policyNumber: q.policy?.number ?? null,
      expiresAt: toDate(q.expiresAt),
      updatedAt: toDate(q.updatedAt),
      boundAt: q.boundAt ? toDate(q.boundAt) : null,
    };

    const activity = quote.pullActivity();

    await prismaTx(tx).quote.upsert({
      where: { id: q.id },
      update: data,
      create: {
        ...data,
        id: q.id,
        tenantId: q.tenantId,
        submissionId: q.submissionId,
        submissionNumber: q.submissionNumber,
        productReleaseId: q.productReleaseId,
        termStart: plainDateToDb(q.termStart),
        termEnd: plainDateToDb(q.termEnd),
        riskData: json(q.riskData),
        createdAt: toDate(q.createdAt),
      },
    });

    if (activity.length > 0) {
      await prismaTx(tx).quoteActivity.createMany({
        data: activity.map((a) => ({
          id: a.id,
          tenantId: q.tenantId,
          quoteId: q.id,
          type: a.type,
          category: a.category,
          occurredAt: toDate(a.occurredAt),
          actor: json(a.actor),
          summary: a.summary,
          data: json(a.data),
        })),
      });
    }
  }

  async listActivity(tx: Transaction, ctx: TenantContext, id: QuoteId): Promise<QuoteActivity[]> {
    const rows = await prismaTx(tx).quoteActivity.findMany({
      where: { tenantId: ctx.tenantId, quoteId: id },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });

    return rows.map((row) => ({
      id: row.id,
      type: row.type as QuoteActivity["type"],
      category: row.category as QuoteActivity["category"],
      occurredAt: toInstant(row.occurredAt),
      actor: row.actor as unknown as QuoteActivity["actor"],
      summary: row.summary,
      data: row.data as Record<string, unknown>,
    }));
  }

  async findById(tx: Transaction, ctx: TenantContext, id: QuoteId): Promise<Quote | null> {
    const row = await prismaTx(tx).quote.findFirst({ where: { tenantId: ctx.tenantId, id } });

    return row ? toQuote(row) : null;
  }

  async findBySubmission(
    tx: Transaction,
    ctx: TenantContext,
    submissionId: SubmissionId,
  ): Promise<Quote | null> {
    const row = await prismaTx(tx).quote.findFirst({
      where: { tenantId: ctx.tenantId, submissionId },
    });

    return row ? toQuote(row) : null;
  }

  async listBySubmissions(
    tx: Transaction,
    ctx: TenantContext,
    submissionIds: readonly SubmissionId[],
  ): Promise<Quote[]> {
    if (submissionIds.length === 0) return [];

    const rows = await prismaTx(tx).quote.findMany({
      where: { tenantId: ctx.tenantId, submissionId: { in: [...submissionIds] } },
    });

    return rows.map(toQuote);
  }

  async savePayment(tx: Transaction, ctx: TenantContext, payment: PaymentAttempt): Promise<void> {
    const at = toDate(payment.recordedAt);

    await prismaTx(tx).quotePayment.create({
      data: {
        id: payment.id,
        tenantId: ctx.tenantId,
        quoteId: payment.quoteId,
        provider: payment.provider,
        providerRef: payment.providerRef,
        status: payment.status,
        amount: payment.amount.toString(),
        currency: payment.amount.currency,
        method: json(payment.method),
        failure: payment.failure,
        createdAt: at,
        updatedAt: at,
      },
    });
  }
}

const DbNull = Prisma.DbNull;

function toQuote(row: QuoteRow): Quote {
  const evaluation = row.evaluation as unknown as EvaluationJson;
  const referral = row.referral as unknown as ReferralJson | null;
  const signature = row.signature as unknown as SignatureJson | null;
  const payment = row.payment as unknown as PaymentJson | null;

  return Quote.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    submissionId: asId(row.submissionId),
    submissionNumber: row.submissionNumber,
    productReleaseId: row.productReleaseId,
    revision: row.revision,
    status: fromDb(row.status),
    termStart: plainDateFromDb(row.termStart),
    termEnd: plainDateFromDb(row.termEnd),
    riskData: row.riskData as Record<string, unknown>,
    selection: row.selection as unknown as CoverageChoice[],
    evaluation: evaluationFromJson(evaluation),
    approvedReasonCodes: referral?.approvedReasonCodes ?? [],
    referral: referral ? referralFromJson(referral) : null,
    details: row.details as unknown as BindDetails | null,
    signature: signature && { ...signature, signedAt: instant(signature.signedAt) },
    payPlan: row.payPlan,
    payment: payment && {
      ...payment,
      amount: money(payment.amount),
      capturedAt: instant(payment.capturedAt),
    },
    policy:
      row.policyId && row.policyNumber ? { id: row.policyId, number: row.policyNumber } : null,
    expiresAt: toInstant(row.expiresAt),
    createdAt: toInstant(row.createdAt),
    updatedAt: toInstant(row.updatedAt),
    boundAt: row.boundAt ? toInstant(row.boundAt) : null,
  });
}
