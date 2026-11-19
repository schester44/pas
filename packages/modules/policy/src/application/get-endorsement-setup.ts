import type { FormDefinition, RiskSchema } from "@pas/forms-core";
import type { TenantContext } from "@pas/kernel";
import { endorsementForm, issuedRisk } from "../domain/endorsable";
import { exposureLabels, indexedExposure } from "../domain/exposures";
import { lifecycleRules } from "../domain/lifecycle";
import type { PolicyScope } from "../domain/scope";
import { coveragesOf } from "../domain/term-state";
import type { CoverageChoice, CoverageOffer } from "../ports/term-rater";
import { type TransactionDto, toTransactionDto } from "./dto";
import { choiceOf } from "./price-endorsement";
import { type ChangeDeps, loadPolicy, today } from "./pricing";

export interface EndorsementSetupDto {
  schema: RiskSchema;
  form: FormDefinition | null;
  /** As last issued, every repeatable row with its stable id. */
  risk: Record<string, unknown>;
  offers: CoverageOffer[];
  selection: CoverageChoice[];
  exposureLabels: Record<string, string>;
  parties: { mailingAddress: unknown; additionalInterests: unknown[] };
  termStart: string;
  termEnd: string;
  /** The suggested date: today, or the latest change if it's later. */
  earliestEffective: string;
  /** How far back a change can go: before issued endorsements when the product rerolls them. */
  earliestAllowed: string;
  /** Issued changes after the term start, newest last: a change dated before them rerolls them. */
  issued: { transactionId: string; type: string; effectiveDate: string }[];
  roles: string[];
  open: TransactionDto | null;
}

const later = (a: Temporal.PlainDate, b: Temporal.PlainDate) =>
  Temporal.PlainDate.compare(a, b) >= 0 ? a : b;

/** What the change editor needs: the endorsable form, the coverage offers and the current state. */
export function makeGetEndorsementSetup(
  deps: Pick<ChangeDeps, "uow" | "policies" | "config" | "rater" | "clocks">,
) {
  return async function getEndorsementSetup(
    ctx: TenantContext,
    scope: PolicyScope,
    input: { policyId: string; roles?: readonly string[] },
  ): Promise<EndorsementSetupDto> {
    const policy = await loadPolicy(deps, ctx, scope, input.policyId);
    const term = policy.currentTerm;
    const snapshot = policy.latestVersion(term.id).snapshot;
    const release = await deps.config.release(ctx, term.productReleaseId);
    const risk = issuedRisk(release.riskSchema, snapshot);
    const coverages = coveragesOf(snapshot);
    const selection = coverages.map(choiceOf);
    const lastChange = policy.lastIssued(term.id)?.effectiveDate ?? term.effectiveDate;
    const now = today(deps.clocks.forTenant(ctx.tenantId));
    const earliest = [now, lastChange, term.effectiveDate].reduce(later);
    const timeline = policy.timeline(term.id).slice(1);
    const reroll = lifecycleRules(release.lifecycle).outOfSequence === "reroll";

    const blocker = timeline.findLast(
      (v) => policy.transaction(v.transactionId).type !== "ENDORSEMENT",
    );

    const earliestAllowed = reroll
      ? later(term.effectiveDate, blocker?.effectiveDate ?? term.effectiveDate)
      : earliest;

    const rating = await deps.rater.rate(ctx, {
      productReleaseId: term.productReleaseId,
      jurisdiction: term.jurisdiction,
      termStart: term.effectiveDate,
      termEnd: term.expirationDate,
      transaction: { type: "ENDORSEMENT", effective: earliest },
      risk,
      coverages: selection.flatMap((c) => {
        const exposure = indexedExposure(risk, c.exposure);

        return exposure === null ? [] : [{ ...c, ...(exposure && { exposure }) }];
      }),
    });

    const parties = (snapshot.parties ?? {}) as Record<string, unknown>;
    const open = policy.openTransaction(term.id);
    const forms = release.forms.map((f) => f.form);

    return {
      schema: release.riskSchema,
      form: endorsementForm(release.riskSchema, release.forms),
      risk,
      offers: rating.offers,
      selection,
      exposureLabels: exposureLabels(
        release.riskSchema,
        forms,
        [risk],
        coverages.map((c) => c.exposure),
      ),
      parties: {
        mailingAddress: parties.mailingAddress ?? risk.mailingAddress ?? null,
        additionalInterests: (parties.additionalInterests ?? []) as unknown[],
      },
      termStart: term.effectiveDate.toString(),
      termEnd: term.expirationDate.toString(),
      earliestEffective: earliest.toString(),
      earliestAllowed: earliestAllowed.toString(),
      issued: timeline.map((v) => ({
        transactionId: v.transactionId,
        type: policy.transaction(v.transactionId).type,
        effectiveDate: v.effectiveDate.toString(),
      })),
      roles: [...(input.roles ?? [])],
      open: open && toTransactionDto(open),
    };
  };
}

export type GetEndorsementSetup = ReturnType<typeof makeGetEndorsementSetup>;
