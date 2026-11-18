import { type DecisionKind, type DecisionResult, evaluateDecision } from "@pas/decisions-engine";
import {
  asId,
  type Clock,
  DomainError,
  invalid,
  Money,
  notFound,
  type Outbox,
  type PlainDate,
  type TenantContext,
  type Transaction,
  type UnitOfWork,
  type ClockProvider,
} from "@pas/kernel";
import { applyEndorsableChanges, sameValue } from "../domain/endorsable";
import { lifecycleRules } from "../domain/lifecycle";
import {
  assertCancellationDate,
  type EarliestCancellation,
  earliestCancellationDate,
  type NoticeRule,
  policyAgeDays,
} from "../domain/notice";
import type { Policy, PolicyTermProps } from "../domain/policy";
import {
  cancellationReturn,
  feesOnCancellation,
  feesOnChange,
  type MinimumEarned,
  premiumDelta,
  sumOf,
} from "../domain/proration";
import type { PolicyScope } from "../domain/scope";
import {
  annualOf,
  coverageJson,
  coveragesOf,
  feesOf,
  type RatedCoverage,
} from "../domain/term-state";
import type { FieldChange, TransactionDetails } from "../domain/transaction";
import type { InvoiceIssuer } from "../ports/invoice-issuer";
import type { PolicyProductConfig, PolicyRelease } from "../ports/product-config";
import type { PolicyRepository } from "../ports/policy-repository";
import type { CoverageAmount, CoverageChoice, TermRater } from "../ports/term-rater";

export interface ChangeDeps {
  uow: UnitOfWork;
  outbox: Outbox;
  policies: PolicyRepository;
  invoices: InvoiceIssuer;
  config: PolicyProductConfig;
  rater: TermRater;
  clocks: ClockProvider;
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

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

function decide<K extends DecisionKind>(
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

const isSameAmount = (a: unknown, b: unknown) => sameValue(a, b);

const amountText = (value: unknown) => {
  const a = value as CoverageAmount | undefined;

  if (!a) return null;

  return a.kind === "money"
    ? Number(a.amount).toLocaleString("en-US", {
        style: "currency",
        currency: a.currency,
        maximumFractionDigits: 0,
      })
    : `${a.value}%`;
};

const exposureLabel = (exposure?: string) => {
  const match = exposure ? /\[(\d+)\]$/.exec(exposure) : null;

  return match ? ` (location ${Number(match[1]) + 1})` : "";
};

const key = (c: RatedCoverage) => `${c.coverage}@${c.exposure ?? ""}`;

function coverageChanges(before: RatedCoverage[], after: RatedCoverage[]): FieldChange[] {
  const was = new Map(before.map((c) => [key(c), c]));
  const now = new Map(after.map((c) => [key(c), c]));
  const changes: FieldChange[] = [];

  for (const [k, c] of now) {
    const old = was.get(k);
    const name = `${c.name}${exposureLabel(c.exposure)}`;

    if (!old) {
      changes.push({
        path: `coverages.${k}`,
        label: `${name} added`,
        before: null,
        after: amountText(c.limit),
      });

      continue;
    }

    if (!isSameAmount(old.limit, c.limit)) {
      changes.push({
        path: `coverages.${k}.limit`,
        label: `${name} limit`,
        before: amountText(old.limit),
        after: amountText(c.limit),
      });
    }

    if (!isSameAmount(old.deductible, c.deductible)) {
      changes.push({
        path: `coverages.${k}.deductible`,
        label: `${name} deductible`,
        before: amountText(old.deductible),
        after: amountText(c.deductible),
      });
    }
  }

  for (const [k, c] of was) {
    if (!now.has(k)) {
      changes.push({
        path: `coverages.${k}`,
        label: `${c.name}${exposureLabel(c.exposure)} removed`,
        before: amountText(c.limit),
        after: null,
      });
    }
  }

  return changes;
}

export const choiceOf = (c: RatedCoverage): CoverageChoice => ({
  coverage: c.coverage,
  ...(c.exposure !== undefined && { exposure: c.exposure }),
  ...(c.limit !== undefined && { limit: c.limit as CoverageAmount }),
  ...(c.deductible !== undefined && { deductible: c.deductible as CoverageAmount }),
});

function acceptedReasonCodes(snapshot: Record<string, unknown>): Set<string> {
  const underwriting = snapshot.underwriting as { acceptedReasonCodes?: string[] } | undefined;
  const codes = new Set(underwriting?.acceptedReasonCodes ?? []);
  const decisions = (snapshot.decisions ?? []) as { ref: string; result: unknown }[];

  for (const decision of decisions) {
    const outcomes = (decision.result as { outcomes?: { reasonCode: string; outcome: string }[] })
      ?.outcomes;

    for (const outcome of outcomes ?? [])
      if (outcome.outcome !== "pass") codes.add(outcome.reasonCode);
  }

  return codes;
}

export interface PartyChanges {
  mailingAddress?: Record<string, unknown> | null;
  additionalInterests?: Record<string, unknown>[];
}

function partyChanges(parties: Record<string, unknown>, input: PartyChanges): FieldChange[] {
  const changes: FieldChange[] = [];

  if (
    input.mailingAddress !== undefined &&
    !isSameAmount(parties.mailingAddress, input.mailingAddress)
  ) {
    changes.push({
      path: "parties.mailingAddress",
      label: "Mailing address",
      before: parties.mailingAddress ?? null,
      after: input.mailingAddress,
    });
  }

  if (
    input.additionalInterests !== undefined &&
    !isSameAmount(parties.additionalInterests ?? [], input.additionalInterests)
  ) {
    changes.push({
      path: "parties.additionalInterests",
      label: "Additional interests",
      before: parties.additionalInterests ?? [],
      after: input.additionalInterests,
    });
  }

  return changes;
}

/** Full-term re-rate at the new state, then the PAS proration of the delta (PLAN §7.4). */
export async function priceEndorsement(
  deps: Pick<ChangeDeps, "config" | "rater">,
  ctx: TenantContext,
  policy: Policy,
  input: {
    effectiveDate: PlainDate;
    risk?: Record<string, unknown>;
    coverages?: CoverageChoice[];
    parties?: PartyChanges;
  },
): Promise<TransactionDetails> {
  const term = policy.currentTerm;
  const snapshot = policy.latestVersion(term.id).snapshot;
  const release = await deps.config.release(ctx, term.productReleaseId);
  const { rounding } = lifecycleRules(release.lifecycle);
  const currentRisk = (snapshot.risk ?? {}) as Record<string, unknown>;

  const { risk, changes } = applyEndorsableChanges(
    release.riskSchema,
    currentRisk,
    input.risk ?? currentRisk,
  );

  const before = coveragesOf(snapshot);

  const rating = await deps.rater.rate(ctx, {
    productReleaseId: term.productReleaseId,
    jurisdiction: term.jurisdiction,
    termStart: term.effectiveDate,
    termEnd: term.expirationDate,
    transaction: { type: "ENDORSEMENT", effective: input.effectiveDate },
    risk,
    coverages: input.coverages ?? before.map(choiceOf),
  });

  if (rating.outcome === "declined") {
    throw new DomainError(
      "precondition_failed",
      `This change makes the risk ineligible: ${rating.reasons
        .filter((r) => r.outcome === "decline")
        .map((r) => r.message)
        .join("; ")}`,
      { reason: "declined", reasons: rating.reasons },
    );
  }

  const parties = (snapshot.parties ?? {}) as Record<string, unknown>;

  const currentParties = {
    ...parties,
    mailingAddress: parties.mailingAddress ?? currentRisk.mailingAddress ?? null,
  };

  const allChanges = [
    ...changes,
    ...coverageChanges(before, rating.coverages),
    ...partyChanges(currentParties, input.parties ?? {}),
  ];

  const period = {
    termStart: term.effectiveDate,
    termEnd: term.expirationDate,
    from: input.effectiveDate,
  };

  const premium = premiumDelta(before, rating.coverages, period, rounding);
  const currency = term.writtenPremium.currency;
  const net = sumOf(premium, currency);

  if (allChanges.length === 0 && premium.length === 0) {
    throw invalid("Nothing changed. Edit the policy before previewing.");
  }

  const fees = net.isZero()
    ? []
    : feesOnChange(
        await deps.rater.taxesOn(ctx, {
          productReleaseId: term.productReleaseId,
          jurisdiction: term.jurisdiction,
          risk,
          premium: net,
        }),
      );

  const accepted = acceptedReasonCodes(snapshot);
  const referrals = rating.reasons.filter((r) => !accepted.has(r.reasonCode));

  const after = {
    ...snapshot,
    risk,
    coverages: rating.coverages.map(coverageJson),
    taxesFees: rating.taxesFees.map((t) => ({
      code: t.code,
      label: t.label,
      remitter: t.remitter,
      amount: t.amount.toJSON(),
    })),
    writtenPremium: rating.writtenPremium.toJSON(),
    total: rating.writtenPremium.plus(sumOf(rating.taxesFees, currency)).toJSON(),
    parties: {
      ...parties,
      ...(risk.mailingAddress !== currentRisk.mailingAddress && {
        mailingAddress: risk.mailingAddress,
      }),
      ...(input.parties?.mailingAddress !== undefined && {
        mailingAddress: input.parties.mailingAddress,
      }),
      ...(input.parties?.additionalInterests !== undefined && {
        additionalInterests: input.parties.additionalInterests,
      }),
    },
    rater: json(rating.rater),
    decisions: json(rating.decisions),
    underwriting: {
      acceptedReasonCodes: [...new Set([...accepted, ...rating.reasons.map((r) => r.reasonCode)])],
    },
  };

  return {
    after,
    premium,
    retained: [],
    fees,
    annualBefore: annualOf(snapshot, currency),
    annualAfter: rating.writtenPremium,
    changes: allChanges,
    referrals,
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
  deps: Pick<ChangeDeps, "config" | "rater" | "clocks">,
  ctx: TenantContext,
  policy: Policy,
  input: { reason: string; effectiveDate?: PlainDate; note?: string },
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
  policy.assertChangeable(term.id, "CANCELLATION", effectiveDate);

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

  const retained = returned.minimumEarned?.lines ?? [];
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
      `The reinstatement window closed on ${windowEnds.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })}. Rewrite the policy instead.`,
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
  const term = policy.currentTerm;
  const billable = charges.filter((line) => !line.amount.isZero());

  if (billable.length === 0) {
    policy.billTransaction(transactionId, null, actor, deps.clocks.forTenant(ctx.tenantId));

    return;
  }

  const issuedOn = today(deps.clocks.forTenant(ctx.tenantId)).toString();

  const invoice = await deps.invoices.issue(tx, ctx, {
    policyId: policy.id,
    policyNumber: policy.number,
    transactionId,
    currency: term.writtenPremium.currency,
    charges: billable.map((line) => ({ ...line, amount: line.amount.toJSON() })),
    issuedOn,
    dueOn: issuedOn,
  });

  policy.billTransaction(
    transactionId,
    { ...invoice, total: Money.of(invoice.total.amount, invoice.total.currency) },
    actor,
    deps.clocks.forTenant(ctx.tenantId),
  );
}

export type { PolicyTermProps };
