import type { DecisionResult } from "@pas/decisions-engine";
import { jurisdiction, type Jurisdiction, type PlainDate } from "@pas/kernel";
import { type DueRule, dueDate, reportingPeriod, type ReportingPeriod } from "./due-date";

export type FilingRule = DecisionResult<"filing_obligations">["obligations"][number];
export type ReportingRule = DecisionResult<"reporting_obligations">["obligations"][number];

export interface IssuedTransaction {
  type: string;
  premium: { amount: string; currency: string };
  effectiveDate: PlainDate;
  issuedDate: PlainDate;
}

export interface DiligentSearchResult {
  required: boolean;
  timing?: string;
  fileAffidavit?: boolean;
}

/** Policy transaction types as decisions see them: `new_business`, `endorsement`, … */
export const transactionCode = (type: string) => type.toLowerCase();

/** What `filing_obligations` decides on, on top of the risk data (PLAN §17.1). */
export function filingDecisionInput(input: {
  risk: Record<string, unknown>;
  jurisdiction: Jurisdiction;
  market: string;
  homeState: string;
  transaction: IssuedTransaction;
  diligentSearch: DiligentSearchResult | null;
}): Record<string, unknown> {
  const premium = Number(input.transaction.premium.amount);

  return {
    ...input.risk,
    jurisdiction: input.jurisdiction,
    market: input.market,
    homeState: input.homeState,
    transaction: {
      type: transactionCode(input.transaction.type),
      premiumBearing: premium !== 0,
      premium,
    },
    diligentSearch: {
      required: input.diligentSearch?.required ?? false,
      fileAffidavit: input.diligentSearch?.fileAffidavit ?? false,
      timing: input.diligentSearch?.timing ?? null,
    },
  };
}

export interface ObligationDraft {
  kind: FilingRule["kind"];
  code: string;
  title: string;
  jurisdiction: Jurisdiction;
  channel: FilingRule["channel"];
  responsible: NonNullable<FilingRule["responsible"]>;
  rule: DueRule;
  dueDate: PlainDate;
  remindDays: number | null;
  escalateDays: number | null;
}

const ruleOf = (row: FilingRule | ReportingRule, from: DueRule["from"]): DueRule => ({
  days: row.dueDays,
  from,
  businessDays: row.businessDays ?? false,
  holidays: row.holidays ?? [],
});

const subdivision = (code: string): Jurisdiction => jurisdiction(code.slice(0, 2), code);

/** Turns the decision's rows into dated obligations for one issued transaction. */
export function draftsForTransaction(
  rows: readonly FilingRule[],
  input: { homeState: string; transaction: IssuedTransaction },
): ObligationDraft[] {
  return rows.map((row) => {
    const rule = ruleOf(row, row.dueFrom);

    return {
      kind: row.kind,
      code: row.code,
      title: row.title,
      jurisdiction: subdivision(row.jurisdiction ?? input.homeState),
      channel: row.channel,
      responsible: row.responsible ?? "licensee",
      rule,
      dueDate: dueDate(rule, {
        effective: input.transaction.effectiveDate,
        issued: input.transaction.issuedDate,
      }),
      remindDays: row.remindDays ?? null,
      escalateDays: row.escalateDays ?? null,
    };
  });
}

export interface PeriodDraft extends ObligationDraft {
  period: ReportingPeriod;
  aggregates: ReportingRule["aggregates"];
}

/** A periodic report owed for the period the transaction was issued in. */
export function draftForPeriod(
  row: ReportingRule,
  input: { homeState: string; issuedDate: PlainDate },
): PeriodDraft {
  const period = reportingPeriod(input.issuedDate, row.frequency);
  const rule = ruleOf(row, "period_end");

  return {
    kind: row.kind,
    code: row.code,
    title: row.title,
    jurisdiction: subdivision(input.homeState),
    channel: row.channel,
    responsible: row.responsible ?? "licensee",
    rule,
    dueDate: dueDate(rule, { periodEnd: period.end }),
    remindDays: row.remindDays ?? null,
    escalateDays: row.escalateDays ?? null,
    period,
    aggregates: row.aggregates,
  };
}

const SUBDIVISION = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;

/**
 * The NRRA home state (PLAN §17.2): what was captured at bind, else the insured's mailing
 * address, else the risk's jurisdiction.
 */
export function homeStateOf(input: {
  declared?: unknown;
  mailingAddress?: { region?: unknown; country?: unknown } | null;
  jurisdiction: Jurisdiction;
}): string {
  if (typeof input.declared === "string" && SUBDIVISION.test(input.declared)) return input.declared;

  const region = input.mailingAddress?.region;
  const country = input.mailingAddress?.country;

  if (typeof region === "string" && typeof country === "string") {
    const code = `${country.toUpperCase()}-${region.toUpperCase()}`;

    if (SUBDIVISION.test(code)) return code;
  }

  return input.jurisdiction.subdivision ?? input.jurisdiction.country;
}
