import { createCensusGeocoder, type DataProvider } from "@pas/enrichment";
import { newId } from "@pas/kernel";
import { z } from "zod";
import type {
  BillingSystem,
  CardPayments,
  ChatChannel,
  EmailSender,
  ESignProvider,
  PrintMail,
} from "../../ports/adapters";
import type { AnyProviderPackage, ProviderManifest } from "../../ports/provider-catalog";
import { builtinAddressProvider } from "./addresses";
import { defaultMockDataConfig, mockDataAdapter } from "./mock-data";

const builtin = {
  vendor: "Built in",
  configSchema: z.object({}),
  secrets: [],
  docsUrl: null,
  testMode: true,
  liveMode: false,
  certified: true,
  builtin: true,
  webhook: null,
} satisfies Partial<ProviderManifest>;

export const NATIVE_BILLING = "native_billing";

const ok = async () => ({ ok: true, detail: "Built in; always available" });

/** Test print and mail: accepts every letter, mails nothing, and certifies mailing at once. */
const testPrintMail: PrintMail = {
  async sendLetter(letter) {
    return {
      providerRef: `ltr_test_${newId()}`,
      status: "mailed",
      mailed: true,
      trackingNumber:
        letter.mailType === "first_class"
          ? null
          : `9407111899560000${String(Date.now()).slice(-6)}`,
      expectedDeliveryDate: null,
    };
  },
};

/** Test chat: accepts every message and posts nothing, so chat destinations work without Slack. */
const testChat: ChatChannel = {
  post: async () => ({ status: 200, body: "ok" }),
};

/**
 * The fakes every tenant always has (CLAUDE.md rule 10). They power a port when nothing else is
 * enabled, and they're all a sandbox ever gets for ports without a test mode.
 */
export function builtinProviders(adapters: {
  payments: Omit<CardPayments, "checkout">;
  esign: ESignProvider;
  email: EmailSender;
  data?: DataProvider;
  /** The native billing system: receives PAS's outbound billing facts for the tenant. */
  billing?: {
    publish(tenantId: string, type: string, data: Record<string, unknown>): Promise<void>;
  };
}): AnyProviderPackage[] {
  const payments: CardPayments = {
    provider: adapters.payments.provider,
    checkout: { kind: "card_form", testMode: true },
    authorize: (ctx, input) => adapters.payments.authorize(ctx, input),
    capture: (ctx, input) => adapters.payments.capture(ctx, input),
    void: (ctx, input) => adapters.payments.void(ctx, input),
    refund: (ctx, input) => adapters.payments.refund(ctx, input),
    saveMethod: (ctx, input) => adapters.payments.saveMethod(ctx, input),
    chargeSaved: (ctx, input) => adapters.payments.chargeSaved(ctx, input),
  };

  const data =
    adapters.data ??
    mockDataAdapter(defaultMockDataConfig(), {
      id: "sandbox_data",
      name: "Sandbox data",
    });

  return [
    {
      manifest: {
        ...builtin,
        id: adapters.payments.provider,
        name: "Test cards",
        category: "payments",
        summary: "Test card numbers; no money moves.",
        description:
          "Accepts 4242 4242 4242 4242 and declines 4000 0000 0000 0002, with authorize, capture, void, refunds and saved cards behaving like a real gateway. 4000 0000 0000 0341 pays at bind but its autopay charges decline.",
        capabilities: ["Authorize and capture", "Declines on demand", "Refunds"],
        logo: { icon: "card" },
      },
      create: () => payments,
      check: ok,
    },
    {
      manifest: {
        ...builtin,
        id: adapters.esign.provider,
        name: "Click to sign",
        category: "esign",
        summary: "Embedded typed-name signature with a sealed certificate.",
        description:
          "The signer types their name and consents in the quote journey. The document is stamped on every page and gets a certificate with the evidence: name, time, IP address, user agent and document hash.",
        capabilities: ["Embedded signing", "Signature certificate", "Document hash"],
        logo: { icon: "signature" },
        liveMode: true,
      },
      create: () => adapters.esign,
      check: ok,
    },
    {
      manifest: {
        ...builtin,
        id: "console_mail",
        name: "Developer mailbox",
        category: "email",
        summary: "Writes each email to the server log instead of sending it.",
        description:
          "Every message, with its sign-in codes and links, goes to the API or worker log. Nothing is delivered.",
        capabilities: ["Log output"],
        logo: { icon: "inbox" },
      },
      create: () => adapters.email,
      check: ok,
    },
    {
      manifest: {
        ...builtin,
        id: "test_print_mail",
        name: "Test print and mail",
        category: "print_mail",
        summary: "Accepts letters and mails nothing.",
        description:
          "Returns a test letter id and, for certified mail, a test tracking number, and records a test proof of mailing at once. Nothing is printed or mailed.",
        capabilities: ["First-class and certified requests"],
        logo: { icon: "printer" },
      },
      create: () => testPrintMail,
      check: ok,
    },
    {
      manifest: {
        ...builtin,
        id: "test_chat",
        name: "Test chat",
        category: "chat",
        summary: "Accepts chat messages and posts nothing.",
        description:
          "Chat destinations deliver to this until a chat provider is enabled, so their delivery log works in sandboxes and local development. Nothing is posted anywhere.",
        capabilities: ["Delivery log only"],
        logo: { icon: "message" },
      },
      create: () => testChat,
      check: ok,
    },
    {
      manifest: {
        ...builtin,
        id: data.manifest.id,
        name: "Sandbox data",
        category: "data",
        summary: "Deterministic, plausible property and hazard data.",
        description:
          "Derives geocodes, property characteristics, hazard scores, tax jurisdictions and replacement costs (with a sample report) from the request, so the same address always returns the same data.",
        capabilities: [
          "Geocode",
          "Property characteristics",
          "Hazard scores",
          "Tax jurisdiction",
          "Replacement cost",
        ],
        supplies: [...data.manifest.capabilities],
        logo: { icon: "database" },
      },
      create: () => data,
      check: ok,
    },
    {
      manifest: {
        ...builtin,
        id: NATIVE_BILLING,
        name: "Native billing",
        category: "billing",
        summary: "The built-in billing system with a double-entry ledger.",
        description:
          "Records card, check, wire, ACH and lockbox payments, applies cash across invoices and statements, handles NSF reversals, refunds, credits and write-offs, and keeps a balanced, append-only journal with trial balance, aging and daily reconciliation against PAS invoices.",
        capabilities: [
          "Double-entry ledger",
          "Cash application",
          "Lockbox import",
          "Reconciliation",
        ],
        logo: { icon: "landmark" },
        liveMode: true,
      },
      create: (settings): BillingSystem => ({
        publish: async (type, data) => adapters.billing?.publish(settings.tenantId, type, data),
      }),
      check: ok,
    },
    builtinAddressProvider(),
  ];
}

const censusConfig = z.object({
  benchmark: z.string().default("Public_AR_Current").meta({ title: "Benchmark" }),
  vintage: z.string().default("Current_Current").meta({ title: "Vintage" }),
});

export const censusGeocoderProvider: AnyProviderPackage = {
  manifest: {
    id: "census_geocoder",
    name: "US Census geocoder",
    vendor: "US Census Bureau",
    category: "data",
    summary: "Free geocoding and county, place and tax geographies for US addresses.",
    description:
      "Matches US addresses to coordinates and FIPS geographies (state, county, place). Free and keyless; there's no test mode, so sandboxes use sandbox data instead.",
    capabilities: ["Geocode", "County and place FIPS"],
    supplies: ["geocode", "tax_jurisdiction"],
    configSchema: censusConfig,
    secrets: [],
    docsUrl: "https://geocoding.geo.census.gov/geocoder/",
    logo: { icon: "map" },
    testMode: false,
    liveMode: true,
    certified: true,
    builtin: false,
    webhook: null,
  },
  create: (settings) =>
    createCensusGeocoder({ ...censusConfig.parse(settings.config), timeoutMs: 4000 }),
  async check(settings) {
    const geocoder = createCensusGeocoder(censusConfig.parse(settings.config));

    const result = await geocoder.fetch(
      "geocode",
      { street: "4600 Silver Hill Rd", city: "Washington", state: "DC", postalCode: "20233" },
      { signal: AbortSignal.timeout(8000) },
    );

    return {
      ok: Boolean(result.latitude),
      detail: result.latitude ? "Geocoded a sample address" : "No match for the sample address",
    };
  },
};
