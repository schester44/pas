import { type ExtensionPoint, POINT_SPECS } from "@pas/extension-points";
import type { StatusTone } from "@pas/ui/components/status-chip";

export const pointLabel = (point: string) =>
  POINT_SPECS[point as ExtensionPoint]?.label ?? point.replaceAll("_", " ");

export const RUN_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  invalid_output: { label: "Invalid output", tone: "warning" },
};

export const SERVICE_LABELS: Record<string, string> = {
  "pas.policy.addNote": "Add a note to a policy's timeline",
  "pas.email.send": "Send an email",
};

/** Each point calls the export named after it. */
export const exportName = (point: string) =>
  point.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function parseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: null };

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export const prettyJson = (value: unknown) =>
  value === undefined ? "" : JSON.stringify(value, null, 2);

const risk = { business: { name: "Acme Hauling" }, vehicles: [{ vin: "1HGCM82633A004352" }] };
const jurisdiction = { country: "US", subdivision: "US-IL" };
const product = { id: "product-id", version: "2027.1" };

/** A starting input per point, matching what PAS passes in. */
export const SAMPLE_INPUTS: Record<string, unknown> = {
  precommit: {
    risk,
    jurisdiction,
    product,
    effectiveDate: "2027-01-01",
    transaction: "NEW_BUSINESS",
  },
  validate: {
    risk,
    jurisdiction,
    product,
    effectiveDate: "2027-01-01",
    transaction: "NEW_BUSINESS",
  },
  underwrite: {
    risk,
    jurisdiction,
    product,
    effectiveDate: "2027-01-01",
    transaction: "NEW_BUSINESS",
    quote: { tiv: 250000, writtenPremium: 1800, selection: [] },
  },
  rate: {
    risk,
    coverages: [{ coverage: "liability", limit: "1000000" }],
    term: { effective: "2027-01-01", expiration: "2028-01-01" },
    transaction: { type: "NEW_BUSINESS", effective: "2027-01-01" },
    jurisdiction,
    currency: "USD",
  },
  installments: {
    risk,
    jurisdiction,
    product,
    plan: { key: "quarterly", label: "Quarterly", installments: 4, intervalMonths: 3 },
    premium: "1800.00",
    currency: "USD",
    taxesFees: [],
    termStart: "2027-01-01",
    termEnd: "2028-01-01",
    billedOn: "2026-12-15",
  },
  cancellation_charges: {
    risk,
    jurisdiction,
    product,
    term: { start: "2027-01-01", end: "2028-01-01", writtenPremium: "1800" },
    cancellation: { reason: "insured_request", initiator: "insured", effectiveDate: "2027-04-01" },
    returned: [{ coverage: "liability", amount: "-1350" }],
    minimumEarned: "0",
    currency: "USD",
  },
  document_select: {
    jurisdiction,
    product,
    risk,
    coverages: ["liability"],
    transaction: "NEW_BUSINESS",
    scheduled: [],
    available: [],
  },
  document_data: { jurisdiction, product, risk, coverages: ["liability"] },
  field_options: { jurisdiction, product, field: "vehicles[].model", values: risk },
  field_prefill: {
    jurisdiction,
    product,
    field: "vehicles[].vin",
    path: "vehicles[#r1].vin",
    values: risk,
  },
  record_panel: {
    record: { type: "policy", id: "policy-id", number: "POL-1001", jurisdiction, product, risk },
  },
  action: { record: { type: "submission", id: "submission-id", status: "draft", risk }, input: {} },
  automation: {
    event: {
      id: "event-id",
      type: "policy.term_bound",
      aggregateType: "policy",
      aggregateId: "policy-id",
      occurredAt: "2027-01-01T15:00:00Z",
      payload: {},
    },
  },
};
