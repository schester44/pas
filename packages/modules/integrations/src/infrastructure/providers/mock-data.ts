import {
  createFakeDataProvider,
  providerCapabilities,
  type DataProvider,
  type ProviderArtifact,
  type ProviderCapability,
  type ProviderRequest,
  type ProviderResponse,
} from "@pas/enrichment";
import { canonicalJson, isRecord, Money } from "@pas/kernel";
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import { z } from "zod";
import type { ProviderPackage, ProviderSettings } from "../../ports/provider-catalog";

const SCENARIOS = [
  "normal",
  "slow",
  "error",
  "timeout",
  "intermittent",
  "partial",
  "conflicting",
] as const;

type Scenario = (typeof SCENARIOS)[number];

const fixtureSchema = z.object({
  match: z.string().min(1).describe("Case-insensitive text the request must contain"),
  capability: z.enum(providerCapabilities).optional(),
  scenario: z.enum(SCENARIOS).optional(),
  response: z.record(z.string(), z.unknown()).optional(),
  report: z.boolean().optional(),
});

const mockConfig = z.object({
  scenario: z
    .enum(SCENARIOS)
    .default("normal")
    .meta({
      title: "Scenario",
      description: "How every call behaves unless a fixture sets its own.",
      optionLabels: {
        normal: "Normal",
        slow: "Slow (adds latency)",
        error: "Always fails",
        timeout: "Never answers",
        intermittent: "Fails some calls",
        partial: "Leaves fields out",
        conflicting: "Disagrees with typical entries",
      },
    }),
  latencyMs: z
    .number()
    .int()
    .min(0)
    .default(1500)
    .meta({ title: "Latency (ms)", description: "Used by the slow scenario." }),
  failureRate: z.number().min(0).max(1).default(0.3).meta({
    title: "Failure rate",
    description: "Share of calls the intermittent scenario fails.",
  }),
  reports: z
    .boolean()
    .default(true)
    .meta({ title: "Supply reports", description: "Return a sample PDF with replacement costs." }),
  costPerCall: z
    .number()
    .min(0)
    .default(0)
    .meta({ title: "Cost per call (USD)", description: "Shows up in enrichment call metering." }),
  fixtures: z.array(fixtureSchema).default([]).meta({
    title: "Fixtures",
    description:
      'Pinned answers, e.g. [{ "match": "123 Coastal", "capability": "replacement_cost", "response": { "replacementCost": 850000 } }].',
  }),
});

export type MockDataConfig = z.infer<typeof mockConfig>;

export const defaultMockDataConfig = (): MockDataConfig => mockConfig.parse({});

/**
 * A data provider for testing enrichment end to end: deterministic answers per address, pinned
 * fixtures, failure and latency scenarios, and a sample report whose figures match its data.
 */
export function mockDataAdapter(
  config: MockDataConfig,
  options: { id?: string; name?: string } = {},
): DataProvider {
  const id = options.id ?? "mock_data";
  const base = createFakeDataProvider({ id });

  const fixtureFor = (capability: ProviderCapability, request: ProviderRequest) => {
    const haystack = normalized(canonicalJson(request));

    return config.fixtures.find(
      (f) =>
        (!f.capability || f.capability === capability) && haystack.includes(normalized(f.match)),
    );
  };

  return {
    manifest: {
      ...base.manifest,
      name: options.name ?? "Mock data",
      costPerCall: Money.of(config.costPerCall, "USD"),
    },
    async fetch(capability, request, { signal }) {
      const fixture = fixtureFor(capability, request);
      const scenario = fixture?.scenario ?? config.scenario;

      await behave(scenario, config, signal);

      const generated = await base.fetch(capability, request, { signal });
      const response = { ...generated, ...fixture?.response };

      if (scenario === "partial") return partial(response);

      if (scenario === "conflicting") return conflicting(response);

      return response;
    },
    async report(capability, request, response) {
      const fixture = fixtureFor(capability, request);

      if (capability !== "replacement_cost" || !(fixture?.report ?? config.reports)) return null;

      return replacementCostReport(request, response);
    },
  };
}

const ABBREVIATIONS: Record<string, string> = {
  avenue: "ave",
  boulevard: "blvd",
  court: "ct",
  drive: "dr",
  lane: "ln",
  place: "pl",
  point: "pt",
  road: "rd",
  street: "st",
};

/** Lowercase words with postal abbreviations, so "12 Harbor Point Road" matches "12 Harbor Pt Rd". */
function normalized(text: string): string {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => ABBREVIATIONS[word] ?? word);

  return ` ${words.join(" ")} `;
}

async function behave(scenario: Scenario, config: MockDataConfig, signal: AbortSignal) {
  if (scenario === "error") throw new Error("Mock data: simulated provider error");

  if (scenario === "intermittent" && Math.random() < config.failureRate) {
    throw new Error("Mock data: simulated intermittent failure");
  }

  if (scenario === "slow") await sleep(config.latencyMs, signal);

  if (scenario === "timeout") await sleep(10 * 60_000, signal);
}

function partial(response: ProviderResponse): ProviderResponse {
  return Object.fromEntries(Object.entries(response).filter((_, index) => index % 2 === 0));
}

const isYear = (value: number) => value > 1800 && value < 2100;

function conflicting(response: ProviderResponse): ProviderResponse {
  return Object.fromEntries(
    Object.entries(response).map(([key, value]) => {
      if (typeof value !== "number") return [key, value];

      return [key, isYear(value) ? value - 12 : Math.round(value * 1.35)];
    }),
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);

    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}

const usd = (value: unknown) =>
  typeof value === "number"
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value)
    : "—";

function addressLines(request: ProviderRequest): string[] {
  const address = request.address;

  if (isRecord(address)) {
    const line = (...keys: string[]) =>
      keys
        .map((k) => address[k])
        .filter((v) => typeof v === "string" && v)
        .join(", ");

    return [line("line1", "street"), line("line2"), line("city", "region", "postalCode")].filter(
      Boolean,
    );
  }

  const parts = [address, request.street, request.city, request.state, request.postalCode];

  return [parts.filter((v) => typeof v === "string" && v).join(", ")].filter(Boolean);
}

async function replacementCostReport(
  request: ProviderRequest,
  response: ProviderResponse,
): Promise<ProviderArtifact> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.42, 0.42, 0.46);
  let y = 740;

  const write = (text: string, x: number, font: PDFFont, size: number, color = ink) =>
    page.drawText(text, { x, y, font, size, color });

  const rightAlign = (target: PDFPage, text: string, right: number, font: PDFFont, size: number) =>
    target.drawText(text, {
      x: right - font.widthOfTextAtSize(text, size),
      y,
      font,
      size,
      color: ink,
    });

  const rule = () => {
    page.drawLine({ start: { x: 56, y }, end: { x: 556, y }, thickness: 0.75, color: muted });
    y -= 18;
  };

  write("Estimated replacement cost report", 56, bold, 18);
  y -= 16;
  write("Mock data · sample report for testing, not a valuation", 56, regular, 9, muted);
  y -= 22;
  rule();

  write("Building", 56, bold, 11);
  y -= 16;

  for (const line of addressLines(request)) {
    write(line, 56, regular, 10);
    y -= 14;
  }

  const facts: [string, string][] = [
    ["Valuation ID", String(response.valuationId ?? "—")],
    ["Square feet", String(response.squareFeet ?? "—")],
    ["Quality", String(response.quality ?? "—")],
    ["Cost per square foot", usd(response.costPerSquareFoot)],
  ];

  y -= 6;

  for (const [label, value] of facts) {
    write(label, 56, regular, 10, muted);
    write(value, 200, regular, 10);
    y -= 14;
  }

  y -= 8;
  rule();
  write("Cost breakdown", 56, bold, 11);
  y -= 18;

  const rows = Array.isArray(response.breakdown) ? response.breakdown.filter(isRecord) : [];

  for (const row of rows) {
    write(String(row.component ?? ""), 56, regular, 10);
    rightAlign(page, usd(row.amount), 556, regular, 10);
    y -= 14;
  }

  y -= 4;
  rule();

  const totals: [string, unknown][] = [
    ["Estimated replacement cost", response.replacementCost],
    ["Total exclusions", response.exclusions],
    ["Insurable replacement cost", response.insurableReplacementCost],
  ];

  for (const [label, value] of totals) {
    write(label, 56, bold, 10);
    rightAlign(page, usd(value), 556, bold, 10);
    y -= 16;
  }

  return {
    kind: "report",
    title: "Replacement cost report",
    contentType: "application/pdf",
    bytes: await pdf.save(),
  };
}

export const mockDataProvider: ProviderPackage<"data"> = {
  manifest: {
    id: "mock_data",
    name: "Mock data",
    vendor: "Built in",
    category: "data",
    summary: "Test-only property, hazard and replacement cost data with scenarios and fixtures.",
    description:
      "For testing enrichment plans: answers every data capability with deterministic data per address, pins fixtures you define, simulates slow, failing, partial and conflicting providers, and returns a sample replacement cost report. Never use it to quote real business. In sandboxes it answers for any data provider a product names.",
    capabilities: [
      "Every data capability",
      "Fixtures",
      "Failure and latency scenarios",
      "Sample reports",
    ],
    supplies: [...providerCapabilities],
    configSchema: mockConfig,
    secrets: [],
    docsUrl: null,
    logo: { icon: "flask" },
    testMode: true,
    liveMode: true,
    certified: false,
    builtin: false,
    standIn: true,
    webhook: null,
  },
  create: (settings: ProviderSettings) => mockDataAdapter(mockConfig.parse(settings.config)),
  check: async (settings) => {
    const config = mockConfig.parse(settings.config);
    const pinned = config.fixtures.length;

    return {
      ok: true,
      detail: `Scenario ${config.scenario}; ${pinned} fixture${pinned === 1 ? "" : "s"}`,
    };
  },
};
