import type { FilingChannel, FilingRequest } from "@pas/compliance";
import { newId } from "@pas/kernel";
import { z } from "zod";
import type { ProviderPackage, ProviderSettings } from "../../ports/provider-catalog";
import { failure } from "./signing";

const ALL_KINDS = [
  "sl_filing",
  "sl_affidavit",
  "sl_remittance",
  "bordereau",
  "stat_report",
  "carrier_report",
  "custom",
];

const covers = (jurisdictions: readonly string[] | "all") => (jurisdiction: string) =>
  jurisdictions === "all" || jurisdictions.includes(jurisdiction);

// A documented trigger, like test card numbers: an insured name containing it is rejected.
const REJECT_TRIGGER = /reject/i;

function testFilingNumber(request: FilingRequest) {
  const state = request.jurisdiction.replace(/^[A-Z]{2}-/, "");
  const serial = newId().replaceAll("-", "").slice(-6).toUpperCase();

  return `TEST-${state}-${serial}`;
}

/** Test filing office: answers every submission a few seconds later, never reaching a state. */
export const testFilingProvider: ProviderPackage<"filing"> = {
  manifest: {
    id: "test_filing",
    name: "Test filing office",
    vendor: "Built in",
    category: "filing",
    summary: "Accepts filings a few seconds after submission and returns a test filing number.",
    description:
      "Behaves like a stamping office API for any obligation kind and state. Filings are accepted after about five seconds with a TEST filing number. A filing is rejected when the insured's name contains “reject” or when no licensee is on record, so corrections can be rehearsed.",
    capabilities: ["Every obligation kind", "Every state", "Rejections on demand"],
    configSchema: z.object({}),
    secrets: [],
    docsUrl: null,
    logo: { icon: "landmark" },
    testMode: true,
    liveMode: false,
    certified: true,
    builtin: true,
    webhook: null,
    files: { kinds: ALL_KINDS, jurisdictions: "all" },
  },
  create: (): FilingChannel => ({
    provider: "test_filing",
    name: "Test filing office",
    delivery: "api",
    pollAfterSeconds: 5,
    serves: () => true,
    submit: async () => ({ status: "submitted", reference: `tst_${newId()}` }),
    poll: async (_ctx, { request }) => {
      const reasons = [
        ...(REJECT_TRIGGER.test(request.insuredName ?? "")
          ? ["Insured name doesn't match the policy declarations"]
          : []),
        ...(request.kind !== "sl_remittance" && !request.licensee
          ? [`No surplus lines licensee on record for ${request.jurisdiction}`]
          : []),
      ];

      return reasons.length > 0
        ? { status: "rejected", reasons }
        : { status: "accepted", filingNumber: testFilingNumber(request) };
    },
  }),
  check: async () => ({ ok: true, detail: "Built in; always available" }),
};

const exportConfig = z.object({
  format: z.enum(["csv", "xml"]).default("csv").meta({ title: "File format" }),
  jurisdictions: z.string().default("").meta({
    title: "States",
    description: "Comma-separated, e.g. US-IN, US-OH. Leave empty for every state.",
  }),
});

const csvCell = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

const xmlText = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const COLUMNS: [string, (r: FilingRequest) => string][] = [
  ["obligation_id", (r) => r.obligationId],
  ["kind", (r) => r.kind],
  ["state", (r) => r.jurisdiction],
  ["policy_number", (r) => r.policyNumber ?? ""],
  ["transaction", (r) => (r.transactionType ?? "").toLowerCase()],
  ["insured", (r) => r.insuredName ?? ""],
  ["effective_date", (r) => r.effectiveDate ?? ""],
  ["expiration_date", (r) => r.expirationDate ?? ""],
  ["issued_date", (r) => r.issuedDate ?? ""],
  ["premium", (r) => r.premium?.amount ?? ""],
  ["taxes", (r) => r.taxesFees.map((t) => `${t.code}=${t.amount.amount}`).join(";")],
  ["licensee", (r) => r.licensee?.name ?? ""],
  ["license_number", (r) => r.licensee?.licenseNumber ?? ""],
  ["correction", (r) => r.correction ?? ""],
];

const jurisdictionsOf = (settings: ProviderSettings): readonly string[] | "all" => {
  const listed = exportConfig
    .parse(settings.config)
    .jurisdictions.split(",")
    .map((j) => j.trim().toUpperCase())
    .filter(Boolean);

  return listed.length > 0 ? listed : "all";
};

/** File export: one upload file per batch plus a checklist, for portals without an API (PLAN §17.2.7). */
export const fileExportFilingProvider: ProviderPackage<"filing"> = {
  manifest: {
    id: "file_export",
    name: "File export",
    vendor: "Built in",
    category: "filing",
    summary: "Generates a CSV or XML file per batch to upload to a state portal, with a checklist.",
    description:
      "For offices without an API. Export a batch from the compliance dashboard, upload the file to the portal, then mark each obligation submitted with its confirmation.",
    capabilities: ["CSV or XML", "Upload checklist", "Any obligation kind"],
    configSchema: exportConfig,
    secrets: [],
    docsUrl: null,
    logo: { icon: "file" },
    testMode: true,
    liveMode: true,
    certified: true,
    builtin: false,
    webhook: null,
    files: { kinds: ALL_KINDS, jurisdictions: "all" },
  },
  create: (settings): FilingChannel => {
    const { format } = exportConfig.parse(settings.config);
    const inScope = covers(jurisdictionsOf(settings));

    return {
      provider: "file_export",
      name: "File export",
      delivery: "file_export",
      serves: (_kind, jurisdiction) => inScope(jurisdiction),
      exportBatch: async (_ctx, { batchId, requests }) => {
        const states = [...new Set(requests.map((r) => r.jurisdiction))].join(", ");
        const stamp = batchId.slice(-8);

        const body =
          format === "xml"
            ? `<?xml version="1.0" encoding="UTF-8"?>\n<filings batch="${batchId}">\n${requests
                .map(
                  (r) =>
                    `  <filing>\n${COLUMNS.map(([name, read]) => `    <${name}>${xmlText(read(r))}</${name}>`).join("\n")}\n  </filing>`,
                )
                .join("\n")}\n</filings>\n`
            : `${[
                COLUMNS.map(([name]) => name),
                ...requests.map((r) => COLUMNS.map(([, read]) => read(r))),
              ]
                .map((row) => row.map(csvCell).join(","))
                .join("\n")}\n`;

        return {
          fileName: `filings-${stamp}.${format}`,
          contentType: format === "xml" ? "application/xml" : "text/csv",
          body: new TextEncoder().encode(body),
          checklist: [
            `Sign in to the filing portal for ${states}`,
            `Upload filings-${stamp}.${format} (${requests.length} ${requests.length === 1 ? "filing" : "filings"})`,
            "Attach the declarations page or affidavit where the portal asks for one",
            "Save the confirmation the portal returns",
            "Mark each obligation submitted with its confirmation number",
          ],
        };
      },
    };
  },
  check: async () => ({ ok: true, detail: "Generates files; nothing to connect" }),
};

const slaiConfig = z.object({
  baseUrl: z
    .url()
    .default("https://efs.slai.org/api/v1")
    .meta({ title: "API base URL", description: "From SLAI when they issue API access." }),
  filerId: z
    .string()
    .default("")
    .meta({ title: "Filer ID", description: "Your SLAI licensee or filer number." }),
});

/*
 * Surplus Line Association of Illinois (PLAN §19 decision 12), from public information only.
 * Verified: SLAI records Illinois home-state surplus lines filings in its Electronic Filing System
 * (EFS), issues an SLAI confirmation number per filing, and evidence of recording must be on the
 * policy before delivery (215 ILCS 5/445(6)); filing within 90 days of the effective date and
 * semiannual tax statements (due Feb 1 and Aug 1) are content in the product's decisions.
 * Assumed until SLAI shares its EFS specification: the base URL, bearer-token auth, the JSON
 * payload and status endpoint below, and the response field names.
 */
const slaiHeaders = (settings: ProviderSettings) => ({
  authorization: `Bearer ${settings.secrets.apiKey ?? ""}`,
  "content-type": "application/json",
  accept: "application/json",
});

const SLAI_TRANSACTIONS: Record<string, string> = {
  new_business: "NEW",
  endorsement: "END",
  cancellation: "CAN",
  reinstatement: "REI",
  cancellation_rescission: "REI",
};

export function slaiFilingPayload(settings: ProviderSettings, request: FilingRequest) {
  const { filerId } = slaiConfig.parse(settings.config);

  return {
    filerId,
    licenseNumber: request.licensee?.licenseNumber ?? null,
    documentType: request.kind === "sl_affidavit" ? "AFFIDAVIT" : "POLICY",
    transactionType: SLAI_TRANSACTIONS[(request.transactionType ?? "").toLowerCase()] ?? "END",
    policyNumber: request.policyNumber,
    insuredName: request.insuredName,
    effectiveDate: request.effectiveDate,
    expirationDate: request.expirationDate,
    premium: request.premium?.amount ?? "0",
    clientReference: `${request.obligationId}:${request.attempt}`,
    ...(request.correction && { correction: request.correction }),
  };
}

export const slaiFilingProvider: ProviderPackage<"filing"> = {
  manifest: {
    id: "slai",
    name: "Surplus Line Association of Illinois",
    vendor: "SLAI",
    category: "filing",
    summary:
      "Files Illinois surplus lines policies and affidavits and returns the SLAI confirmation number.",
    description:
      "Submits each Illinois home-state filing to SLAI's electronic filing system and records the confirmation number, or the reasons when SLAI rejects it. Needs API credentials from SLAI; the request format follows SLAI's public filing requirements and will be certified against their specification.",
    capabilities: [
      "Policy filings",
      "Endorsements and cancellations",
      "Diligent search affidavits",
    ],
    configSchema: slaiConfig,
    secrets: [{ key: "apiKey", label: "API key", description: "Issued by SLAI with API access." }],
    docsUrl: "https://www.slai.org",
    logo: { mark: "S" },
    testMode: false,
    liveMode: true,
    certified: false,
    builtin: false,
    webhook: null,
    requiresCredentials: true,
    files: { kinds: ["sl_filing", "sl_affidavit"], jurisdictions: ["US-IL"] },
  },
  create: (settings): FilingChannel => {
    const { baseUrl } = slaiConfig.parse(settings.config);

    return {
      provider: "slai",
      name: "SLAI",
      delivery: "api",
      pollAfterSeconds: 300,
      serves: (kind, jurisdiction) =>
        jurisdiction === "US-IL" && (kind === "sl_filing" || kind === "sl_affidavit"),
      submit: async (_ctx, request) => {
        const response = await fetch(`${baseUrl}/filings`, {
          method: "POST",
          headers: slaiHeaders(settings),
          body: JSON.stringify(slaiFilingPayload(settings, request)),
        });

        if (!response.ok) throw await failure(response);

        const body = (await response.json()) as {
          id?: string;
          status?: string;
          confirmationNumber?: string;
          errors?: string[];
        };

        const reference = body.id ?? `${request.obligationId}:${request.attempt}`;

        if (body.status === "rejected")
          return { status: "rejected", reference, reasons: body.errors ?? ["Rejected by SLAI"] };

        return body.confirmationNumber
          ? { status: "accepted", reference, filingNumber: body.confirmationNumber }
          : { status: "submitted", reference };
      },
      poll: async (_ctx, { reference }) => {
        const response = await fetch(`${baseUrl}/filings/${encodeURIComponent(reference)}`, {
          headers: slaiHeaders(settings),
        });

        if (!response.ok) throw await failure(response);

        const body = (await response.json()) as {
          status?: string;
          confirmationNumber?: string;
          errors?: string[];
        };

        if (body.status === "rejected")
          return { status: "rejected", reasons: body.errors ?? ["Rejected by SLAI"] };

        return body.confirmationNumber
          ? { status: "accepted", filingNumber: body.confirmationNumber }
          : { status: "pending" };
      },
    };
  },
  check: async (settings) => {
    if (!settings.secrets.apiKey) return { ok: false, detail: "Add the API key SLAI issued" };

    try {
      const { baseUrl } = slaiConfig.parse(settings.config);
      const response = await fetch(`${baseUrl}/ping`, { headers: slaiHeaders(settings) });

      return response.ok
        ? { ok: true, detail: "Connected to SLAI" }
        : { ok: false, detail: `SLAI answered ${response.status}` };
    } catch (error) {
      return { ok: false, detail: `Couldn't reach SLAI: ${(error as Error).message}` };
    }
  },
};
