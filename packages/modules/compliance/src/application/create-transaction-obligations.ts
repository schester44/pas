import { type DecisionResult, evaluateDecision } from "@pas/decisions-engine";
import {
  type Clock,
  jurisdiction,
  type Jurisdiction,
  jurisdictionCode,
  jurisdictionTimeZone,
  parsePlainDate,
  type TenantContext,
  type Transaction,
} from "@pas/kernel";
import { lateFrom } from "../domain/due-date";
import { type Licensee, licenseeFor } from "../domain/licensee";
import { Obligation, type ResponsibleParty } from "../domain/obligation";
import {
  type DiligentSearchResult,
  draftForPeriod,
  draftsForTransaction,
  filingDecisionInput,
  homeStateOf,
  type IssuedTransaction,
  type ObligationDraft,
  type ReportingRule,
} from "../domain/obligation-rules";
import type { ComplianceRelease, TransactionFacts } from "../ports/policy-source";
import { type ComplianceDeps, persist } from "./deps";

type Address = { region?: unknown; country?: unknown } | null;

interface BoundSnapshot {
  parties?: {
    homeState?: unknown;
    mailingAddress?: Address;
    declinations?: unknown[];
  } | null;
  decisions?: { ref: string; result: unknown }[];
}

const formatDate = (date: Temporal.PlainDate) =>
  date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });

function responsibleFor(
  draft: ObligationDraft,
  licensee: Licensee | null,
  tenantName: string,
): ResponsibleParty {
  if (draft.responsible === "licensee" && licensee) {
    return {
      type: "licensee",
      name: licensee.name,
      licensee: {
        id: licensee.id,
        name: licensee.name,
        licenseNumber: licensee.licenseNumber,
        jurisdiction: licensee.jurisdiction,
      },
    };
  }

  return {
    type: draft.responsible === "licensee" ? "tenant" : draft.responsible,
    name: tenantName,
    licensee: null,
  };
}

function evaluate<K extends "filing_obligations" | "reporting_obligations">(
  release: ComplianceRelease,
  kind: K,
  data: Record<string, unknown>,
): { row: DecisionResult<K>["obligations"][number]; ref: string }[] {
  return release.rules
    .filter((r) => r.kind === kind)
    .flatMap((r) =>
      (
        evaluateDecision(kind, r.decision, data, { cacheKey: `${release.id}:${kind}.${r.key}` })
          .result.obligations as DecisionResult<K>["obligations"]
      ).map((row) => ({ row, ref: `${kind}.${r.key}` })),
    );
}

/**
 * Creates the obligations an issued transaction owes, from the release's `filing_obligations`
 * decision, plus the periodic report each one feeds (PLAN §17.1, §17.2.7–8). Idempotent per
 * transaction and rule code.
 */
export function makeCreateTransactionObligations(
  deps: ComplianceDeps & { tenantName: (ctx: TenantContext) => Promise<string> },
) {
  return async function createTransactionObligations(
    ctx: TenantContext,
    input: { policyId: string; transactionId: string },
  ): Promise<{ created: number }> {
    const facts = await deps.policies.transaction(ctx, input);
    const release = await deps.policies.release(ctx, facts.productReleaseId);

    if (!release.rules.some((r) => r.kind === "filing_obligations")) return { created: 0 };

    const risk = jurisdiction(facts.jurisdiction.country, facts.jurisdiction.subdivision);
    const bound = facts.bound as BoundSnapshot;

    const homeState = homeStateOf({
      declared: bound.parties?.homeState,
      mailingAddress:
        bound.parties?.mailingAddress ?? (facts.risk.mailingAddress as Address | undefined),
      jurisdiction: risk,
    });

    const diligentSearch = (bound.decisions?.find((d) => d.ref.startsWith("dea."))?.result ??
      null) as DiligentSearchResult | null;

    const transaction: IssuedTransaction = {
      type: facts.transaction.type,
      premium: facts.transaction.premium,
      effectiveDate: parsePlainDate(facts.transaction.effectiveDate),
      issuedDate: Temporal.Instant.from(facts.transaction.issuedAt)
        .toZonedDateTimeISO(jurisdictionTimeZone(risk))
        .toPlainDate(),
    };

    const decisionData = filingDecisionInput({
      risk: facts.risk,
      jurisdiction: risk,
      market: release.market,
      homeState,
      transaction,
      diligentSearch,
    });

    const rows = evaluate(release, "filing_obligations", decisionData);

    if (rows.length === 0) return { created: 0 };

    const drafts = draftsForTransaction(
      rows.map((r) => r.row),
      { homeState, transaction },
    ).map((draft, index) => ({ draft, ref: rows[index]!.ref }));

    const tenantName = await deps.tenantName(ctx);
    const clock = deps.clocks.forTenant(ctx.tenantId);

    const reporting = (kind: string) =>
      evaluate(release, "reporting_obligations", { ...decisionData, report: { kind } }).filter(
        (r) => r.row.aggregates === kind,
      );

    return deps.uow.run(ctx, async (tx) => {
      const licensees = await deps.licensees.list(tx, ctx);
      const created: Obligation[] = [];

      for (const { draft, ref } of drafts) {
        const key = `${facts.transaction.id}:${draft.code}`;

        if (await deps.obligations.findByDedupeKey(tx, ctx, key)) continue;

        const licensee = licenseeFor(licensees, jurisdictionCode(draft.jurisdiction));

        const obligation = Obligation.create(
          {
            tenantId: ctx.tenantId,
            dedupeKey: key,
            kind: draft.kind,
            code: draft.code,
            title: draft.title,
            jurisdiction: draft.jurisdiction,
            subject: {
              type: "transaction",
              policyId: facts.policyId,
              policyNumber: facts.policyNumber,
              termId: facts.termId,
              transactionId: facts.transaction.id,
              transactionType: facts.transaction.type,
              periodStart: null,
              periodEnd: null,
            },
            responsible: responsibleFor(draft, licensee, tenantName),
            channel: draft.channel,
            rule: draft.rule,
            timer: { remindDays: draft.remindDays, escalateDays: draft.escalateDays },
            dueDate: draft.dueDate,
            lateFrom: lateFrom(draft.dueDate, jurisdictionTimeZone(draft.jurisdiction)),
            data: transactionData(facts, transaction, {
              homeState,
              market: release.market,
              licenseeMissing: draft.responsible === "licensee" && !licensee,
              ...(draft.kind === "sl_affidavit" && {
                affidavit: { declinations: bound.parties?.declinations ?? [], diligentSearch },
              }),
            }),
            source: { releaseId: release.id, decision: ref },
          },
          clock,
        );

        await persist(deps, tx, obligation);
        created.push(obligation);

        for (const { row, ref: reportRef } of reporting(draft.kind)) {
          await ensurePeriodObligation(deps, tx, ctx, clock, {
            row,
            ref: reportRef,
            homeState,
            issuedDate: transaction.issuedDate,
            responsible: responsibleFor(
              { ...draft, responsible: row.responsible ?? "licensee" },
              licensee,
              tenantName,
            ),
            releaseId: release.id,
          });
        }
      }

      if (created.length > 0) {
        await deps.timeline.record(tx, ctx, {
          policyId: facts.policyId,
          transactionId: facts.transaction.id,
          type: "obligations_created",
          summary: `${created.length} compliance ${created.length === 1 ? "obligation" : "obligations"}: ${created
            .map((o) => `${o.toSnapshot().title} due ${formatDate(o.toSnapshot().dueDate)}`)
            .join("; ")}`,
          data: { count: created.length, obligationIds: created.map((o) => o.id) },
        });
      }

      return { created: created.length };
    });
  };
}

function transactionData(
  facts: TransactionFacts,
  transaction: IssuedTransaction,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    insuredName: facts.insuredName,
    productId: facts.productId,
    riskState: facts.jurisdiction.subdivision ?? facts.jurisdiction.country,
    effectiveDate: transaction.effectiveDate.toString(),
    expirationDate: facts.termExpirationDate,
    issuedDate: transaction.issuedDate.toString(),
    premium: facts.transaction.premium,
    taxesFees: facts.taxesFees,
    ...extra,
  };
}

async function ensurePeriodObligation(
  deps: ComplianceDeps,
  tx: Transaction,
  ctx: TenantContext,
  clock: Clock,
  input: {
    row: ReportingRule;
    ref: string;
    homeState: string;
    issuedDate: Temporal.PlainDate;
    responsible: ResponsibleParty;
    releaseId: string;
  },
): Promise<void> {
  const draft = draftForPeriod(input.row, {
    homeState: input.homeState,
    issuedDate: input.issuedDate,
  });

  const owner = input.responsible.licensee?.id ?? "tenant";
  const key = `period:${draft.code}:${owner}:${input.homeState}:${draft.period.start.toString()}`;

  if (await deps.obligations.findByDedupeKey(tx, ctx, key)) return;

  const where: Jurisdiction = draft.jurisdiction;

  await persist(
    deps,
    tx,
    Obligation.create(
      {
        tenantId: ctx.tenantId,
        dedupeKey: key,
        kind: draft.kind,
        code: draft.code,
        title: draft.title,
        jurisdiction: where,
        subject: {
          type: "period",
          policyId: null,
          policyNumber: null,
          termId: null,
          transactionId: null,
          transactionType: null,
          periodStart: draft.period.start.toString(),
          periodEnd: draft.period.end.toString(),
        },
        responsible: input.responsible,
        channel: draft.channel,
        rule: draft.rule,
        timer: { remindDays: draft.remindDays, escalateDays: draft.escalateDays },
        dueDate: draft.dueDate,
        lateFrom: lateFrom(draft.dueDate, jurisdictionTimeZone(where)),
        data: { aggregates: draft.aggregates, frequency: input.row.frequency },
        source: { releaseId: input.releaseId, decision: input.ref },
      },
      clock,
    ),
  );
}
