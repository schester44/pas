import { noExtensions, prepareWith, validateWith } from "@pas/extension-points";
import { rowIdOf, rowPath } from "@pas/forms-core";
import {
  DomainError,
  formatMoney,
  formatPlainDate,
  invalid,
  Money,
  type PlainDate,
  type TenantContext,
  toPlainJson,
} from "@pas/kernel";
import { applyEndorsableChanges, intakeForm, issuedRisk } from "../domain/endorsable";
import { exposureLabels, indexedExposure, stableExposure } from "../domain/exposures";
import { lifecycleRules, type LifecycleRules } from "../domain/lifecycle";
import type { Policy, PolicyTermProps, TermVersionProps } from "../domain/policy";
import { type FeeLine, feesOnChange, premiumDelta, sumOf } from "../domain/proration";
import {
  applyCoverageEdits,
  applyRiskEdits,
  type CoverageChoiceLike,
  coverageEdits,
  describeChanges,
  type RiskEdit,
  riskEdits,
} from "../domain/risk-diff";
import { sameValue } from "../domain/same-value";
import { annualOf, coverageJson, coveragesOf, type RatedCoverage } from "../domain/term-state";
import type {
  Charges,
  FieldChange,
  ReferralReason,
  RerollConflict,
  RerollSegment,
  TransactionDetails,
} from "../domain/transaction";
import type { PolicyRelease } from "../ports/product-config";
import type { CoverageAmount, CoverageChoice, TermRating } from "../ports/term-rater";
import type { ChangeDeps } from "./pricing";

export interface PartyChanges {
  mailingAddress?: Record<string, unknown> | null;
  additionalInterests?: Record<string, unknown>[];
}

export const choiceOf = (c: RatedCoverage | CoverageChoiceLike): CoverageChoice => ({
  coverage: c.coverage,
  ...(c.exposure !== undefined && { exposure: c.exposure }),
  ...(c.limit !== undefined && { limit: c.limit as CoverageAmount }),
  ...(c.deductible !== undefined && { deductible: c.deductible as CoverageAmount }),
});

const amountText = (value: unknown) => {
  const a = value as CoverageAmount | undefined;

  if (!a) return null;

  return a.kind === "money" ? formatMoney(a, { cents: false }) : `${a.value}%`;
};

const key = (c: RatedCoverage) => `${c.coverage}@${c.exposure ?? ""}`;

/**
 * Coverage changes by name and exposure. Coverages that come and go with a row added or removed
 * are left to that row's own change.
 */
function coverageChanges(
  before: RatedCoverage[],
  after: RatedCoverage[],
  labels: Record<string, string>,
  rowsChanged: ReadonlySet<string>,
): FieldChange[] {
  const was = new Map(before.map((c) => [key(c), c]));
  const now = new Map(after.map((c) => [key(c), c]));
  const changes: FieldChange[] = [];

  const name = (c: RatedCoverage) =>
    c.exposure && labels[c.exposure] ? `${c.name} · ${labels[c.exposure]}` : c.name;

  const ownChange = (c: RatedCoverage) => !c.exposure || !rowsChanged.has(c.exposure);

  for (const [k, c] of now) {
    const old = was.get(k);

    if (!old) {
      if (ownChange(c)) {
        changes.push({
          path: `coverages.${k}`,
          label: `${name(c)} added`,
          before: null,
          after: amountText(c.limit),
        });
      }

      continue;
    }

    if (!sameValue(old.limit, c.limit)) {
      changes.push({
        path: `coverages.${k}.limit`,
        label: `${name(c)} limit`,
        before: amountText(old.limit),
        after: amountText(c.limit),
      });
    }

    if (!sameValue(old.deductible, c.deductible)) {
      changes.push({
        path: `coverages.${k}.deductible`,
        label: `${name(c)} deductible`,
        before: amountText(old.deductible),
        after: amountText(c.deductible),
      });
    }
  }

  for (const [k, c] of was) {
    if (!now.has(k) && ownChange(c)) {
      changes.push({
        path: `coverages.${k}`,
        label: `${name(c)} removed`,
        before: amountText(c.limit),
        after: null,
      });
    }
  }

  return changes;
}

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

const partiesOf = (snapshot: Record<string, unknown>) => {
  const parties = (snapshot.parties ?? {}) as Record<string, unknown>;
  const risk = (snapshot.risk ?? {}) as Record<string, unknown>;

  return {
    ...parties,
    mailingAddress: parties.mailingAddress ?? risk.mailingAddress ?? null,
    additionalInterests: parties.additionalInterests ?? [],
  };
};

/** Only what differs from `current`: a party change re-applied elsewhere carries just the edit. */
function partyEdits(current: Record<string, unknown>, input: PartyChanges): PartyChanges {
  return {
    ...(input.mailingAddress !== undefined &&
      !sameValue(current.mailingAddress, input.mailingAddress) && {
        mailingAddress: input.mailingAddress,
      }),
    ...(input.additionalInterests !== undefined &&
      !sameValue(current.additionalInterests ?? [], input.additionalInterests) && {
        additionalInterests: input.additionalInterests,
      }),
  };
}

function partyChanges(parties: Record<string, unknown>, input: PartyChanges): FieldChange[] {
  const changes: FieldChange[] = [];

  if (input.mailingAddress !== undefined) {
    changes.push({
      path: "parties.mailingAddress",
      label: "Mailing address",
      before: parties.mailingAddress ?? null,
      after: input.mailingAddress,
    });
  }

  if (input.additionalInterests !== undefined) {
    changes.push({
      path: "parties.additionalInterests",
      label: "Additional interests",
      before: parties.additionalInterests ?? [],
      after: input.additionalInterests,
    });
  }

  return changes;
}

interface Pricer {
  deps: Pick<ChangeDeps, "config" | "rater">;
  ctx: TenantContext;
  term: PolicyTermProps;
  release: PolicyRelease;
  rules: LifecycleRules;
}

interface PricedState {
  snapshot: Record<string, unknown>;
  risk: Record<string, unknown>;
  coverages: RatedCoverage[];
  reasons: TermRating["reasons"];
}

/** The rater addresses rows by position; the policy keeps exposures by row id. */
async function rateState(
  p: Pricer,
  input: {
    base: Record<string, unknown>;
    risk: Record<string, unknown>;
    choices: readonly CoverageChoiceLike[];
    parties: PartyChanges;
    effective: PlainDate;
    what: string;
  },
): Promise<PricedState> {
  const coverages = input.choices.flatMap((c) => {
    const exposure = indexedExposure(input.risk, c.exposure);

    return exposure === null ? [] : [choiceOf({ ...c, ...(exposure && { exposure }) })];
  });

  const rating = await p.deps.rater.rate(p.ctx, {
    productReleaseId: p.term.productReleaseId,
    jurisdiction: p.term.jurisdiction,
    termStart: p.term.effectiveDate,
    termEnd: p.term.expirationDate,
    transaction: { type: "ENDORSEMENT", effective: input.effective },
    risk: input.risk,
    coverages,
  });

  if (rating.outcome === "declined") {
    throw new DomainError(
      "precondition_failed",
      `${input.what} makes the risk ineligible: ${rating.reasons
        .filter((r) => r.outcome === "decline")
        .map((r) => r.message)
        .join("; ")}`,
      { reason: "declined", reasons: rating.reasons },
    );
  }

  const rated = rating.coverages.map((c) => ({
    ...c,
    ...(c.exposure !== undefined && { exposure: stableExposure(input.risk, c.exposure)! }),
  }));

  const currency = p.term.writtenPremium.currency;
  const parties = (input.base.parties ?? {}) as Record<string, unknown>;
  const baseRisk = (input.base.risk ?? {}) as Record<string, unknown>;
  const accepted = acceptedReasonCodes(input.base);

  const snapshot = {
    ...input.base,
    risk: input.risk,
    coverages: rated.map(coverageJson),
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
      ...(!sameValue(input.risk.mailingAddress, baseRisk.mailingAddress) && {
        mailingAddress: input.risk.mailingAddress,
      }),
      ...input.parties,
    },
    rater: toPlainJson(rating.rater),
    decisions: toPlainJson(rating.decisions),
    underwriting: {
      acceptedReasonCodes: [...new Set([...accepted, ...rating.reasons.map((r) => r.reasonCode)])],
    },
  };

  return { snapshot, risk: input.risk, coverages: rated, reasons: rating.reasons };
}

async function feesOn(p: Pricer, risk: Record<string, unknown>, premium: { amount: Money }[]) {
  const net = sumOf(premium, p.term.writtenPremium.currency);

  if (net.isZero()) return [];

  return feesOnChange(
    await p.deps.rater.taxesOn(p.ctx, {
      productReleaseId: p.term.productReleaseId,
      jurisdiction: p.term.jurisdiction,
      risk,
      premium: net,
    }),
  );
}

const negated = (charges: Charges, risk: unknown): Charges => ({
  premium: charges.premium.map((line) => ({
    ...line,
    ...(line.exposure !== undefined && { exposure: stableExposure(risk, line.exposure)! }),
    before: line.after,
    after: line.before,
    amount: line.amount.negated(),
  })),
  retained: charges.retained.map((line) => ({ ...line, amount: line.amount.negated() })),
  fees: charges.fees.map((line): FeeLine => ({ ...line, amount: line.amount.negated() })),
});

const editPath = (edit: RiskEdit) =>
  edit.op === "add" ? rowPath(edit.path, rowIdOf(edit.row) ?? "") : edit.path;

/**
 * Prices an endorsement (PLAN §7.4): full-term re-rate on the pinned release, the per-coverage
 * delta prorated from its date. Dated before issued endorsements, it applies to the state in
 * force on its date and rerolls them: each is offset in full and re-applied on top, re-priced
 * from its own date; where both touch the same thing, the later one wins from its date.
 */
export async function priceEndorsement(
  deps: Pick<ChangeDeps, "config" | "rater" | "extensions">,
  ctx: TenantContext,
  policy: Policy,
  input: {
    effectiveDate: PlainDate;
    transactionId?: string;
    risk?: Record<string, unknown>;
    coverages?: CoverageChoice[];
    parties?: PartyChanges;
    roles?: readonly string[];
  },
): Promise<TransactionDetails> {
  const term = policy.currentTerm;
  const release = await deps.config.release(ctx, term.productReleaseId);
  const rules = lifecycleRules(release.lifecycle);
  const p: Pricer = { deps, ctx, term, release, rules };
  const D = input.effectiveDate;

  policy.assertChangeable(term.id, "ENDORSEMENT", D, input.transactionId, {
    outOfSequence: rules.outOfSequence === "reroll",
  });

  const schema = release.riskSchema;
  const forms = release.forms.map((f) => f.form);
  const currency = term.writtenPremium.currency;
  const timeline = policy.timeline(term.id);
  const latest = timeline.at(-1)!;
  const base = policy.versionAt(term.id, D);
  const later = timeline.filter((v) => Temporal.PlainDate.compare(v.effectiveDate, D) > 0);
  const latestRisk = issuedRisk(schema, latest.snapshot);
  const baseRisk = issuedRisk(schema, base.snapshot);

  const { risk: edited } = applyEndorsableChanges(schema, latestRisk, input.risk ?? latestRisk, {
    context: {
      transaction: { effectiveDate: D.toString() },
      term: {
        effectiveDate: term.effectiveDate.toString(),
        expirationDate: term.expirationDate.toString(),
      },
      actor: { roles: input.roles ?? [] },
    },
    form: intakeForm(release.forms),
    forms,
  });

  const hook = {
    jurisdiction: term.jurisdiction,
    product: { id: release.productId, version: release.version },
    effectiveDate: D.toString(),
    transaction: "ENDORSEMENT",
  };

  const invoker = deps.extensions ?? noExtensions;
  const subject = { type: "policy", id: policy.id };

  const prepared = await prepareWith(
    invoker,
    ctx,
    release.extensions,
    { ...hook, risk: edited },
    subject,
  );

  const errors = await validateWith(
    invoker,
    ctx,
    release.extensions,
    { ...hook, risk: prepared },
    subject,
  );

  if (Object.keys(errors).length > 0) {
    throw invalid(Object.values(errors).flat()[0] ?? "The change isn't valid", {
      reason: "extension_validation",
      errors,
    });
  }

  const risk =
    base === latest ? prepared : rebased(baseRisk, riskEdits(schema, latestRisk, prepared));

  const latestChoices = coveragesOf(latest.snapshot).map(choiceOf);
  const before = coveragesOf(base.snapshot);

  const choices = applyCoverageEdits(
    before.map(choiceOf),
    coverageEdits(latestChoices, input.coverages ?? latestChoices),
  );

  const parties = partyEdits(partiesOf(latest.snapshot), input.parties ?? {});

  const own = await rateState(p, {
    base: base.snapshot,
    risk,
    choices,
    parties,
    effective: D,
    what: "This change",
  });

  const premium = premiumDelta(before, own.coverages, period(term, D), rules.rounding);
  const riskChanges = describeChanges(schema, forms, baseRisk, risk);
  const rowsChanged = new Set(riskChanges.filter((c) => c.path.endsWith("]")).map((c) => c.path));
  const segments: RerollSegment[] = [];
  const referrals: ReferralReason[] = [...own.reasons];
  const states: PricedState[] = [own];
  const ours = new Map<string, FieldChange>();
  let previous = own;

  for (const segment of later) {
    const original = timeline[timeline.indexOf(segment) - 1]!;
    const priced = await reroll(p, policy, { segment, original, previous, ours });

    segments.push(priced.segment);
    referrals.push(...priced.state.reasons);
    states.push(priced.state);
    previous = priced.state;
  }

  const labels = exposureLabels(
    schema,
    forms,
    [...states.map((s) => s.risk), baseRisk, latestRisk],
    [
      ...states.flatMap((s) => s.coverages.map((c) => c.exposure)),
      ...before.map((c) => c.exposure),
      ...segments.flatMap((s) => s.reversed.premium.map((l) => l.exposure)),
    ],
  );

  const changes = [
    ...riskChanges,
    ...coverageChanges(before, own.coverages, labels, rowsChanged),
    ...partyChanges(partiesOf(base.snapshot), parties),
  ];

  for (const change of changes) ours.set(change.path, change);

  for (const segment of segments) segment.conflicts = conflictsOf(segment, ours);

  if (changes.length === 0 && premium.length === 0 && segments.length === 0) {
    throw invalid("Nothing changed. Edit the policy before previewing.");
  }

  const accepted = acceptedReasonCodes(latest.snapshot);

  return {
    after: own.snapshot,
    premium,
    retained: [],
    fees: await feesOn(p, risk, premium),
    annualBefore: annualOf(latest.snapshot, currency),
    annualAfter: previous.coverages.reduce((sum, c) => sum.plus(c.premium), Money.zero(currency)),
    changes,
    referrals: uniqueReasons(referrals.filter((r) => !accepted.has(r.reasonCode))),
    ...(segments.length > 0 && { reroll: segments }),
    exposureLabels: labels,
  };
}

const period = (term: PolicyTermProps, from: PlainDate) => ({
  termStart: term.effectiveDate,
  termEnd: term.expirationDate,
  from,
});

function rebased(base: Record<string, unknown>, edits: RiskEdit[]) {
  const { risk, skipped } = applyRiskEdits(base, edits);

  if (skipped.length > 0) {
    throw invalid(
      "Part of this change edits something added by a later endorsement. Date it on or after that endorsement.",
      { paths: skipped.map(editPath) },
    );
  }

  return risk;
}

const uniqueReasons = (reasons: ReferralReason[]) => [
  ...new Map(reasons.map((r) => [r.reasonCode, r])).values(),
];

/** Offsets a later change in full and re-applies its edits over the new state, from its date. */
async function reroll(
  p: Pricer,
  policy: Policy,
  input: {
    segment: TermVersionProps;
    original: TermVersionProps;
    previous: PricedState;
    ours: Map<string, FieldChange>;
  },
): Promise<{ segment: RerollSegment; state: PricedState }> {
  const { segment, original, previous } = input;
  const schema = p.release.riskSchema;
  const forms = p.release.forms.map((f) => f.form);
  const transaction = policy.transaction(segment.transactionId);
  const label = `${formatPlainDate(segment.effectiveDate)} endorsement`;
  const from = issuedRisk(schema, original.snapshot);
  const to = issuedRisk(schema, segment.snapshot);
  const { risk, skipped } = applyRiskEdits(previous.risk, riskEdits(schema, from, to));

  const choices = applyCoverageEdits(
    previous.coverages.map(choiceOf),
    coverageEdits(
      coveragesOf(original.snapshot).map(choiceOf),
      coveragesOf(segment.snapshot).map(choiceOf),
    ),
  );

  const parties = partyEdits(
    partiesOf(original.snapshot),
    partiesOf(segment.snapshot) as PartyChanges,
  );

  const state = await rateState(p, {
    base: previous.snapshot,
    risk,
    choices,
    parties,
    effective: segment.effectiveDate,
    what: `Re-rating the ${label}`,
  });

  const premium = premiumDelta(
    previous.coverages,
    state.coverages,
    period(p.term, segment.effectiveDate),
    p.rules.rounding,
  );

  const described = [
    ...describeChanges(schema, forms, from, to),
    ...coverageChanges(
      coveragesOf(original.snapshot),
      coveragesOf(segment.snapshot),
      {},
      new Set(),
    ),
    ...partyChanges(partiesOf(original.snapshot), parties),
  ];

  const dropped = new Set(skipped.map(editPath));

  return {
    state,
    segment: {
      transactionId: transaction.id,
      effectiveDate: segment.effectiveDate.toString(),
      label,
      reversed: negated(policy.chargesOfVersion(segment), segment.snapshot.risk),
      reissued: { premium, retained: [], fees: await feesOn(p, risk, premium) },
      after: state.snapshot,
      changes: described.filter((c) => !dropped.has(c.path)),
      conflicts: described
        .filter((c) => dropped.has(c.path))
        .map((c) => ({ ...conflictOf(c, null), outcome: "no_longer_applies" as const })),
    },
  };
}

const conflictOf = (
  theirs: FieldChange,
  ours: FieldChange | null,
): Omit<RerollConflict, "outcome"> => ({
  path: theirs.path,
  label: theirs.label,
  ours: ours?.after ?? null,
  theirs: theirs.after,
});

/** Where a rerolled change and this one touch the same thing, the later one wins from its date. */
function conflictsOf(segment: RerollSegment, ours: Map<string, FieldChange>): RerollConflict[] {
  const overridden = segment.changes.flatMap((c) => {
    const mine = ours.get(c.path);

    return mine ? [{ ...conflictOf(c, mine), outcome: "theirs_from_date" as const }] : [];
  });

  return [...segment.conflicts, ...overridden];
}
