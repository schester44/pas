import { parsePlainDate, type TenantContext } from "@pas/kernel";
import { lifecycleRules } from "../domain/lifecycle";
import type { PolicyScope } from "../domain/scope";
import { type TransactionDto, toTransactionDto } from "./dto";
import { type ChangeDeps, loadPolicy, priceCancellation } from "./pricing";

export interface CancellationQuoteDto {
  reasons: { code: string; label: string; initiator: string }[];
  reason: string;
  earliestDate: string;
  /** Changes can't go before the last issued transaction yet (no out-of-sequence reroll). */
  lastChangeDate: string | null;
  effectiveDate: string;
  atInception: boolean;
  /** Null where no notice rule covers the cancellation, so no notice goes out. */
  rule: {
    minDaysNotice: number;
    mailingDaysAdded: number;
    delivery: string;
    recipients: string[];
    source: { version: string; fallback: boolean };
  } | null;
  jurisdiction: { country: string; subdivision?: string };
  termStart: string;
  termEnd: string;
  preview: Omit<TransactionDto, "id" | "status" | "createdAt" | "createdBy" | "issuedAt">;
}

/** The earliest valid date for a reason, with why, and the return premium for a date. */
export function makeQuoteCancellation(
  deps: Pick<ChangeDeps, "uow" | "policies" | "config" | "rater" | "clocks">,
) {
  return async function quoteCancellation(
    ctx: TenantContext,
    scope: PolicyScope,
    input: { policyId: string; reason: string; effectiveDate?: string },
  ): Promise<CancellationQuoteDto> {
    const policy = await loadPolicy(deps, ctx, scope, input.policyId);
    const term = policy.currentTerm;
    const release = await deps.config.release(ctx, term.productReleaseId);

    const pricing = await priceCancellation(deps, ctx, policy, {
      reason: input.reason,
      ...(input.effectiveDate && { effectiveDate: parsePlainDate(input.effectiveDate) }),
    });

    const {
      id: _id,
      status: _s,
      createdAt: _c,
      createdBy: _b,
      issuedAt: _i,
      ...preview
    } = toTransactionDto({
      id: "",
      termId: term.id,
      type: "CANCELLATION",
      status: "quoted",
      effectiveDate: pricing.effectiveDate,
      premiumDelta: term.writtenPremium.minus(term.writtenPremium),
      baseVersion: 0,
      details: pricing.details,
      createdBy: null,
      createdAt: Temporal.Instant.fromEpochMilliseconds(0),
      updatedAt: Temporal.Instant.fromEpochMilliseconds(0),
      issuedAt: null,
    });

    const premium = [
      ...pricing.details.premium.map((l) => l.amount),
      ...pricing.details.retained.map((l) => l.amount),
    ].reduce((sum, amount) => sum.plus(amount), term.writtenPremium.minus(term.writtenPremium));

    return {
      reasons: lifecycleRules(release.lifecycle).reasons,
      reason: input.reason,
      earliestDate: pricing.earliest.date.toString(),
      lastChangeDate:
        policy.lastIssued(term.id)?.type === "NEW_BUSINESS"
          ? null
          : (policy.lastIssued(term.id)?.effectiveDate.toString() ?? null),
      effectiveDate: pricing.effectiveDate.toString(),
      atInception: pricing.earliest.atInception,
      rule:
        pricing.rule && pricing.ruleSource
          ? {
              minDaysNotice: pricing.rule.minDaysNotice,
              mailingDaysAdded: pricing.earliest.mailingDaysAdded,
              delivery: pricing.earliest.delivery,
              recipients: [...pricing.rule.recipients],
              source: {
                version: pricing.ruleSource.version,
                fallback: pricing.ruleSource.fallback,
              },
            }
          : null,
      jurisdiction: term.jurisdiction,
      termStart: term.effectiveDate.toString(),
      termEnd: term.expirationDate.toString(),
      preview: { ...preview, premiumDelta: premium.toJSON() },
    };
  };
}

export type QuoteCancellation = ReturnType<typeof makeQuoteCancellation>;

export function makeCancellationReasons(deps: Pick<ChangeDeps, "uow" | "policies" | "config">) {
  return async function cancellationReasons(
    ctx: TenantContext,
    scope: PolicyScope,
    input: { policyId: string },
  ) {
    const policy = await loadPolicy(deps, ctx, scope, input.policyId);
    const release = await deps.config.release(ctx, policy.currentTerm.productReleaseId);

    return lifecycleRules(release.lifecycle).reasons;
  };
}
