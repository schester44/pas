import { type BindingInvoker, bindingsAt, noExtensions } from "@pas/extension-points";
import { withCancellationCharges } from "../domain/cancellation-charges";
import { type DecisionKind, type DecisionResult, evaluateDecision } from "@pas/decisions-engine";
import {
  asId,
  type Clock,
  type ClockProvider,
  DomainError,
  formatPlainDate,
  invalid,
  jurisdictionCode,
  Money,
  notFound,
  type Outbox,
  type PlainDate,
  type TenantContext,
  type Transaction,
  type UnitOfWork,
} from "@pas/kernel";
import { lifecycleRules } from "../domain/lifecycle";
import {
  assertCancellationDate,
  type EarliestCancellation,
  earliestCancellationDate,
  type NoticeRule,
  policyAgeDays,
} from "../domain/notice";
import type { Policy, PolicyTermProps, TransactionInvoice } from "../domain/policy";
import {
  cancellationReturn,
  feesOnCancellation,
  feesOnChange,
  type MinimumEarned,
  premiumDelta,
  sumOf,
} from "../domain/proration";
import type { PolicyScope } from "../domain/scope";
import { annualOf, coveragesOf, feesOf } from "../domain/term-state";
import type { TransactionDetails } from "../domain/transaction";
import type { InvoiceIssuer, IssuedInvoice } from "../ports/invoice-issuer";
import type { PolicyProductConfig, PolicyRelease } from "../ports/product-config";
import type { PolicyRepository } from "../ports/policy-repository";
import type { CarrierTransactions } from "../ports/carrier-transactions";
import type { TermRater } from "../ports/term-rater";

export interface ChangeDeps {
  uow: UnitOfWork;
  outbox: Outbox;
  policies: PolicyRepository;
  invoices: InvoiceIssuer;
  config: PolicyProductConfig;
  rater: TermRater;
  clocks: ClockProvider;
  /** Carrier-owned changes go to the carrier first (PLAN §12); absent where no carrier is wired. */
  carriers?: CarrierTransactions;
  extensions?: BindingInvoker;
}

export interface Authority {
  issue: boolean;
  approveReferrals: boolean;
}

export async function loadPolicy(
  deps: Pick<ChangeDeps, "uow" | "policies">,
  ctx: TenantContext,
  scope: PolicyScope,
  policyId: string,
  tx?: Transaction,
): Promise<Policy> {
  const find = (t: Transaction) => deps.policies.findById(t, ctx, scope, asId(policyId));
  const policy = tx ? await find(tx) : await deps.uow.run(ctx, find);

  if (!policy) throw notFound("Policy", policyId);

  return policy;
}

export const today = (clock: Clock) => clock.today("UTC");

export function decide<K extends DecisionKind>(
  release: PolicyRelease,
  kind: K,
  data: Record<string, unknown>,
): DecisionResult<K> | undefined {
  const rule = release.rules.find((r) => r.kind === kind);

  if (!rule) return undefined;

  return evaluateDecision(kind, rule.decision, data, {
    cacheKey: `${release.id}:${kind}.${rule.key}`,
  }).result;
}

export interface NoticeRuleSource {
  releaseId: string;
  version: string;
  fallback: boolean;
}

/**
 * The term's release decides notice rules. A release published before notice rules existed
 * falls back to the newest published release for the jurisdiction that has them: notice law
 * applies on the notice date, not by policy version.
 */
async function noticeRuleFor(
  deps: Pick<ChangeDeps, "config">,
  ctx: TenantContext,
  release: PolicyRelease,
  data: Record<string, unknown>,
): Promise<{ rule: NoticeRule | null; source: NoticeRuleSource } | null> {
  const own = release.rules.some((r) => r.kind === "notice_rules");

  const candidates = own
    ? [release]
    : (
        await deps.config.publishedReleases(ctx, {
          productId: release.productId,
          jurisdiction: release.jurisdiction,
        })
      ).filter((r) => r.rules.some((rule) => rule.kind === "notice_rules"));

  const source = candidates[0];

  if (!source) return null;

  return {
    rule: decide(source, "notice_rules", data) ?? null,
    source: { releaseId: source.id, version: source.version, fallback: !own },
  };
}

export interface CancellationPricing {
  details: TransactionDetails;
  effectiveDate: PlainDate;
  earliest: EarliestCancellation;
  rule: NoticeRule;
  ruleSource: NoticeRuleSource;
}

function minimumEarnedOf(
  terms: DecisionResult<"cancellation_terms"> | undefined,
): MinimumEarned | null {
  if (!terms?.minimumEarnedType || terms.minimumEarnedValue === undefined) return null;

  return {
    type: terms.minimumEarnedType,
    value: terms.minimumEarnedValue,
    level: terms.minimumEarnedLevel ?? "policy",
    appliesTo: terms.minimumEarnedAppliesTo ?? [],
  };
}

/**
 * Earliest valid date from `notice_rules`, then the return premium: pro rata by coverage, with
 * the minimum earned premium and fully earned fees from `cancellation_terms` (PLAN §7.4, §17.3).
 */
export async function priceCancellation(
  deps: Pick<ChangeDeps, "config" | "rater" | "clocks" | "extensions">,
  ctx: TenantContext,
  policy: Policy,
  input: { reason: string; effectiveDate?: PlainDate; note?: string; transactionId?: string },
): Promise<CancellationPricing> {
  const term = policy.currentTerm;
  const snapshot = policy.latestVersion(term.id).snapshot;
  const release = await deps.config.release(ctx, term.productReleaseId);
  const lifecycle = lifecycleRules(release.lifecycle);
  const reason = lifecycle.reasons.find((r) => r.code === input.reason);

  if (!reason)
    throw invalid("Choose a cancellation reason this product allows", { field: "reason" });

  const noticeDate = today(deps.clocks.forTenant(ctx.tenantId));
  const inception = policy.toSnapshot().terms[0]!.effectiveDate;

  const data = {
    ...((snapshot.risk ?? {}) as Record<string, unknown>),
    jurisdiction: term.jurisdiction,
    notice: {
      type: "cancellation",
      reason: reason.code,
      initiator: reason.initiator,
      policyAgeDays: policyAgeDays(inception, noticeDate),
    },
    cancellation: { reason: reason.code, initiator: reason.initiator },
  };

  const notice = await noticeRuleFor(deps, ctx, release, data);

  if (!notice?.rule) {
    throw new DomainError(
      "precondition_failed",
      `No notice rule covers ${reason.label.toLowerCase()} cancellations here. Add one to the product's notice rules.`,
      { reason: "no_notice_rule" },
    );
  }

  const earliest = earliestCancellationDate({
    noticeDate,
    termStart: term.effectiveDate,
    termEnd: term.expirationDate,
    reason: reason.code,
    rule: notice.rule,
  });

  const lastChange = policy.lastIssued(term.id)?.effectiveDate;

  const effectiveDate =
    input.effectiveDate ?? (lastChange ? maxDate(earliest.date, lastChange) : earliest.date);

  assertCancellationDate(effectiveDate, earliest);
  policy.assertChangeable(term.id, "CANCELLATION", effectiveDate, input.transactionId);

  const terms = decide(release, "cancellation_terms", data);
  const currency = term.writtenPremium.currency;

  const period = {
    termStart: term.effectiveDate,
    termEnd: term.expirationDate,
    from: effectiveDate,
  };

  const returned = cancellationReturn(coveragesOf(snapshot), period, lifecycle.rounding, {
    minimumEarned: minimumEarnedOf(terms),
    codes: [reason.code, reason.initiator],
  });

  const [chargesBinding] = bindingsAt(release.extensions, "cancellation_charges");

  const charged = chargesBinding
    ? await (deps.extensions ?? noExtensions).invoke(
        ctx,
        chargesBinding,
        {
          risk: snapshot.risk ?? {},
          jurisdiction: term.jurisdiction,
          product: { id: release.productId, version: release.version },
          term: {
            start: term.effectiveDate.toString(),
            end: term.expirationDate.toString(),
            writtenPremium: term.writtenPremium.toString(),
          },
          cancellation: {
            reason: reason.code,
            initiator: reason.initiator,
            effectiveDate: effectiveDate.toString(),
            noticeDate: noticeDate.toString(),
          },
          returned: returned.lines.map((l) => ({
            coverage: l.coverage,
            ...(l.exposure !== undefined && { exposure: l.exposure }),
            amount: l.amount.toString(),
          })),
          minimumEarned: (returned.minimumEarned?.retained ?? Money.zero(currency)).toString(),
          currency,
        },
        { type: "policy", id: policy.id },
      )
    : null;

  const retained = withCancellationCharges(
    returned.lines,
    returned.minimumEarned?.lines ?? [],
    charged?.charges ?? [],
    currency,
  );

  const net = sumOf([...returned.lines, ...retained], currency);
  const fullyEarnedFees = terms?.fullyEarnedFees ?? [];

  const fees = net.isZero()
    ? []
    : feesOnCancellation(
        await deps.rater.taxesOn(ctx, {
          productReleaseId: term.productReleaseId,
          jurisdiction: term.jurisdiction,
          risk: (snapshot.risk ?? {}) as Record<string, unknown>,
          premium: net,
        }),
        feesOf(snapshot),
        period,
        lifecycle.rounding,
        fullyEarnedFees,
      );

  const annual = annualOf(snapshot, currency);

  return {
    effectiveDate,
    earliest,
    rule: notice.rule,
    ruleSource: notice.source,
    details: {
      after: {
        ...snapshot,
        status: "cancelled",
        cancellation: { effectiveDate: effectiveDate.toString(), reason: reason.code },
      },
      premium: returned.lines,
      retained,
      fees,
      annualBefore: annual,
      annualAfter: annual,
      changes: [],
      referrals: [],
      cancellation: {
        reason: reason.code,
        reasonLabel: reason.label,
        initiator: reason.initiator,
        method: "pro_rata",
        noticeDate: noticeDate.toString(),
        earliestDate: earliest.date.toString(),
        minDaysNotice: earliest.minDaysNotice,
        mailingDaysAdded: earliest.mailingDaysAdded,
        delivery: earliest.delivery,
        minimumEarned: returned.minimumEarned,
        fullyEarnedFees,
      },
      ...(input.note && { note: input.note }),
    },
  };
}

export interface ReinstatementPricing {
  details: TransactionDetails;
  effectiveDate: PlainDate;
  cancelledOn: PlainDate;
  windowEnds: PlainDate;
}

/** Premium back from the reinstatement date, inside the product's window (PLAN §7.3). */
export async function priceReinstatement(
  deps: Pick<ChangeDeps, "config" | "rater" | "clocks">,
  ctx: TenantContext,
  policy: Policy,
  input: { lapse: boolean; effectiveDate?: PlainDate; note?: string },
): Promise<ReinstatementPricing> {
  const term = policy.currentTerm;

  if (term.status !== "cancelled" || term.cancellation?.status !== "effective") {
    throw new DomainError("precondition_failed", "Only a cancelled policy can be reinstated");
  }

  const release = await deps.config.release(ctx, term.productReleaseId);
  const lifecycle = lifecycleRules(release.lifecycle);
  const cancelledOn = term.cancellation.effectiveDate;
  const windowEnds = cancelledOn.add({ days: lifecycle.reinstatementWindowDays });
  const now = today(deps.clocks.forTenant(ctx.tenantId));

  if (Temporal.PlainDate.compare(now, windowEnds) > 0) {
    throw new DomainError(
      "precondition_failed",
      `The reinstatement window closed on ${formatPlainDate(windowEnds)}. Rewrite the policy instead.`,
      { reason: "window_closed" },
    );
  }

  const effectiveDate = input.lapse
    ? (input.effectiveDate ?? maxDate(now, cancelledOn))
    : cancelledOn;

  if (Temporal.PlainDate.compare(effectiveDate, cancelledOn) < 0) {
    throw invalid("A reinstatement with a lapse starts on or after the cancellation date", {
      field: "effectiveDate",
    });
  }

  policy.assertChangeable(term.id, "REINSTATEMENT", effectiveDate);

  const snapshot = policy.latestVersion(term.id).snapshot;
  const coverages = coveragesOf(snapshot);
  const currency = term.writtenPremium.currency;

  const period = {
    termStart: term.effectiveDate,
    termEnd: term.expirationDate,
    from: effectiveDate,
  };

  const premium = premiumDelta([], coverages, period, lifecycle.rounding);
  const net = sumOf(premium, currency);

  const fees = net.isZero()
    ? []
    : feesOnChange(
        await deps.rater.taxesOn(ctx, {
          productReleaseId: term.productReleaseId,
          jurisdiction: term.jurisdiction,
          risk: (snapshot.risk ?? {}) as Record<string, unknown>,
          premium: net,
        }),
      );

  const { status: _status, cancellation: _cancellation, ...restored } = snapshot;
  const annual = annualOf(snapshot, currency);

  return {
    effectiveDate,
    cancelledOn,
    windowEnds,
    details: {
      after: {
        ...restored,
        reinstatement: { lapse: input.lapse, effectiveDate: effectiveDate.toString() },
      },
      premium,
      retained: [],
      fees,
      annualBefore: annual,
      annualAfter: annual,
      changes: [],
      referrals: [],
      reinstatement: { lapse: input.lapse, cancelledOn: cancelledOn.toString() },
      ...(input.note && { note: input.note }),
    },
  };
}

const maxDate = (a: PlainDate, b: PlainDate) => (Temporal.PlainDate.compare(a, b) >= 0 ? a : b);

/** Bills an issued transaction in the same unit of work and links it on the timeline. */
export async function billIssued(
  deps: Pick<ChangeDeps, "invoices" | "clocks">,
  tx: Transaction,
  ctx: TenantContext,
  policy: Policy,
  transactionId: string,
  charges: ReturnType<Policy["issueTransaction"]>,
  actor: Parameters<Policy["billTransaction"]>[2],
): Promise<void> {
  const clock = deps.clocks.forTenant(ctx.tenantId);
  const term = policy.currentTerm;
  const billable = charges.filter((line) => !line.amount.isZero());

  if (billable.length === 0) {
    policy.billTransaction(transactionId, null, actor, clock);

    return;
  }

  const issuedOn = today(clock).toString();

  const transaction = policy.transaction(transactionId);

  const invoice = await deps.invoices.issue(tx, ctx, {
    policyId: policy.id,
    policyNumber: policy.number,
    termId: transaction.termId,
    transactionId,
    transactionType: transaction.type,
    effectiveDate: transaction.effectiveDate.toString(),
    jurisdiction: jurisdictionCode(term.jurisdiction),
    currency: term.writtenPremium.currency,
    charges: billable.map((line) => ({ ...line, amount: line.amount.toJSON() })),
    issuedOn,
    dueOn: issuedOn,
  });

  policy.billTransaction(transactionId, transactionInvoice(invoice), actor, clock);
}

export function transactionInvoice(invoice: IssuedInvoice): TransactionInvoice {
  const { netted, ...rest } = invoice;

  return {
    ...rest,
    total: Money.fromJSON(invoice.total),
    ...(netted && {
      netted: { credited: Money.fromJSON(netted.credited), installments: netted.installments },
    }),
  };
}

export type { PolicyTermProps };
