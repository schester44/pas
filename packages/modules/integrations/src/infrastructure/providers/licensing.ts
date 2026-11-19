import { z } from "zod";
import type { ProducerLicenseLookup, ProducerLicenseRecord } from "../../ports/adapters";
import type {
  AnyProviderPackage,
  ProviderPackage,
  ProviderSettings,
} from "../../ports/provider-catalog";
import { failure } from "./signing";

const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const fakeConfig = z.object({
  subdivisions: z.string().default("").meta({
    title: "Licensed in",
    description: "ISO 3166-2 codes, comma separated, e.g. US-IL, US-IN.",
  }),
  linesOfAuthority: z
    .string()
    .default("Property, Casualty")
    .meta({ title: "Lines of authority", description: "Comma separated." }),
  expirationDate: z
    .string()
    .default("")
    .meta({ title: "Expires", description: "ISO date. Leave empty for no expiry." }),
});

/** Sandbox licensing: every NPN holds the configured licenses, except NPNs ending in 0, which hold none. */
function fakeLicensing(settings: ProviderSettings): ProducerLicenseLookup {
  const config = fakeConfig.parse(settings.config);

  return {
    provider: "test_licensing",
    async licenses(_ctx, producer) {
      if (!producer.npn || producer.npn.endsWith("0")) return [];

      return list(config.subdivisions).map((subdivision) => ({
        npn: producer.npn!,
        country: subdivision.slice(0, 2),
        subdivision,
        licenseNumber: `TEST-${subdivision}-${producer.npn}`,
        linesOfAuthority: list(config.linesOfAuthority),
        effectiveDate: "2000-01-01",
        expirationDate: config.expirationDate || null,
        status: "active" as const,
      }));
    },
  };
}

const niprConfig = z.object({
  environment: z
    .enum(["beta", "production"])
    .default("beta")
    .meta({ title: "Environment", description: "Beta answers with NIPR's test data." }),
  country: z.string().default("US").meta({ title: "Country" }),
});

const NIPR_HOSTS = {
  beta: "https://pdb-services-beta.nipr.com",
  production: "https://pdb-services.nipr.com",
} as const;

/*
 * NIPR's Producer Database (PDB) Entity Information report, XML over HTTPS, per NPN. Modelled from
 * NIPR's public PDB web-services material; the full schema comes with a NIPR subscription, so the
 * request and the XML mapping live in this pair of functions to fix in one place.
 */
export function niprRequest(settings: ProviderSettings, npn: string): Request {
  const config = niprConfig.parse(settings.config);
  const url = new URL("/pdb-xml-reports/entityinfo_xml.cgi", NIPR_HOSTS[config.environment]);

  url.searchParams.set("customer_number", settings.secrets.customerNumber ?? "");
  url.searchParams.set("pin_number", settings.secrets.pin ?? "");
  url.searchParams.set("report_type", "1");
  url.searchParams.set("id_entity", npn);

  return new Request(url, { headers: { accept: "application/xml" } });
}

const blocks = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => ({
    attributes: m[1] ?? "",
    body: m[2] ?? "",
  }));

const field = (xml: string, tag: string) =>
  new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1]?.trim() ?? "";

const usDate = (value: string) => {
  const [month, day, year] = value.split("/");

  return month && day && year ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : null;
};

export function niprResponse(xml: string, npn: string, country: string): ProducerLicenseRecord[] {
  return blocks(xml, "STATE").flatMap((state) => {
    const code = /name="([A-Z]{2})"/.exec(state.attributes)?.[1];

    if (!code) return [];

    return blocks(state.body, "LICENSE").map((license) => {
      const details = blocks(license.body, "DETAIL");

      return {
        npn,
        country,
        subdivision: `${country}-${code}`,
        licenseNumber: field(license.body, "LICENSE_NUM"),
        linesOfAuthority: details
          .filter((d) => field(d.body, "STATUS").toLowerCase() === "active")
          .map((d) => field(d.body, "LOA"))
          .filter(Boolean),
        effectiveDate: usDate(field(license.body, "DATE_ISSUE_LICENSE_ORIG")) ?? "1900-01-01",
        expirationDate: usDate(field(license.body, "DATE_EXPIRE_LICENSE")),
        status: field(license.body, "ACTIVE").toLowerCase() === "yes" ? "active" : "inactive",
      };
    });
  });
}

export function niprProvider(fetchImpl: typeof fetch = fetch): ProviderPackage<"licensing"> {
  const lookup = async (settings: ProviderSettings, npn: string) => {
    const response = await fetchImpl(niprRequest(settings, npn), {
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw await failure(response);

    return niprResponse(await response.text(), npn, niprConfig.parse(settings.config).country);
  };

  return {
    manifest: {
      id: "nipr_pdb",
      name: "NIPR Producer Database",
      vendor: "NIPR",
      category: "licensing",
      summary: "Live license and line-of-authority lookups by NPN.",
      description:
        "Looks up a producer's licenses by NPN in NIPR's Producer Database at quote and bind: state, license number, lines of authority, status and expiration. Needs a NIPR PDB subscription.",
      capabilities: ["Licenses by NPN", "Lines of authority", "Expiration dates"],
      configSchema: niprConfig,
      secrets: [
        { key: "customerNumber", label: "Customer number" },
        { key: "pin", label: "PIN" },
      ],
      docsUrl: "https://nipr.com/help/what-is-the-pdb",
      logo: { mark: "N" },
      testMode: true,
      liveMode: true,
      certified: false,
      builtin: false,
      requiresCredentials: true,
      webhook: null,
    },
    create: (settings) => ({
      provider: "nipr_pdb",
      licenses: async (_ctx, producer) => (producer.npn ? lookup(settings, producer.npn) : []),
    }),
    async check(settings) {
      if (!settings.secrets.customerNumber || !settings.secrets.pin) {
        return { ok: false, detail: "Add your NIPR customer number and PIN" };
      }

      const response = await fetchImpl(niprRequest(settings, "0"), {
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) throw await failure(response);

      return { ok: true, detail: "NIPR accepted the credentials" };
    },
  };
}

const ok = async () => ({ ok: true, detail: "Built in; always available" });

/** The licensing sources: licenses on file (built in), a sandbox fake and NIPR. */
export function licensingProviders(onFile: ProducerLicenseLookup): AnyProviderPackage[] {
  return [
    {
      manifest: {
        id: onFile.provider,
        name: "Licenses on file",
        vendor: "Built in",
        category: "licensing",
        summary: "Checks the licenses kept on each producer's record.",
        description:
          "Staff and agency admins record each producer's licenses and lines of authority; quote and bind check them for the risk state and effective date.",
        capabilities: ["Manual license records", "Expiry warnings"],
        configSchema: z.object({}),
        secrets: [],
        docsUrl: null,
        logo: { icon: "badge" },
        testMode: true,
        liveMode: true,
        certified: true,
        builtin: true,
        webhook: null,
      },
      create: () => onFile,
      check: ok,
    },
    {
      manifest: {
        id: "test_licensing",
        name: "Test licensing",
        vendor: "Built in",
        category: "licensing",
        summary: "Licenses every NPN in the states you list; NPNs ending in 0 hold none.",
        description:
          "For sandboxes: answers like a licensing database without one. Every NPN is licensed in the states and lines you configure, except NPNs ending in 0, which hold no licenses.",
        capabilities: ["Deterministic licenses", "Unlicensed NPNs on demand"],
        configSchema: fakeConfig,
        secrets: [],
        docsUrl: null,
        logo: { icon: "badge" },
        testMode: true,
        liveMode: false,
        certified: true,
        builtin: false,
        webhook: null,
      },
      create: fakeLicensing,
      check: ok,
    },
    niprProvider(),
  ];
}
