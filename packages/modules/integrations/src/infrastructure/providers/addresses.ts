import {
  type AddressProvider,
  createFakeAddressProvider,
  createGeoapifyAutocomplete,
  createSmartyAddressProvider,
  DEMO_CITIES,
} from "@pas/addressing";
import { z } from "zod";
import type { ProviderPackage, ProviderSettings } from "../../ports/provider-catalog";

const SAMPLE = {
  line1: "4600 Silver Hill Rd",
  city: "Washington",
  region: "DC",
  postalCode: "20233",
  country: "US",
};

export function builtinAddressProvider(): ProviderPackage<"address"> {
  const adapter = createFakeAddressProvider();

  return {
    manifest: {
      id: adapter.id,
      name: "Sample addresses",
      vendor: "Built in",
      category: "address",
      summary: "Deterministic suggestions and verification for a few demo cities.",
      description: `Suggests and verifies street addresses in ${DEMO_CITIES.join(", ")}, with county, ZIP+4 and a stable address id. House numbers from 9000 up and addresses elsewhere stay unverified, so the "use as entered" path can be tried. Nothing leaves the PAS.`,
      capabilities: ["Autocomplete", "Verification", "County and FIPS", "Stable address id"],
      configSchema: z.object({}),
      secrets: [],
      docsUrl: null,
      logo: { icon: "map" },
      testMode: true,
      liveMode: false,
      certified: true,
      builtin: true,
      webhook: null,
    },
    create: () => adapter,
    check: async () => ({ ok: true, detail: "Built in; always available" }),
  };
}

const smartyConfig = z.object({
  match: z.enum(["strict", "enhanced"]).default("strict").meta({
    title: "Match strategy",
    description:
      "Strict accepts only USPS-deliverable addresses. Enhanced needs a Smarty plan that includes it.",
  }),
  rooftop: z.boolean().default(false).meta({
    title: "Rooftop geocodes",
    description:
      "Needs the US Rooftop Geocoding licence. Rooftop coordinates must be deleted if the subscription ends.",
  }),
});

const smartySettings = (settings: ProviderSettings) => ({
  ...smartyConfig.parse(settings.config),
  authId: settings.secrets.authId ?? "",
  authToken: settings.secrets.authToken ?? "",
});

export function smartyProvider(fetchImpl: typeof fetch = fetch): ProviderPackage<"address"> {
  const create = (settings: ProviderSettings): AddressProvider =>
    createSmartyAddressProvider("smarty", smartySettings(settings), fetchImpl);

  return {
    manifest: {
      id: "smarty",
      name: "Smarty",
      vendor: "Smarty",
      category: "address",
      summary: "USPS-verified addresses with SmartyKey, county FIPS and geocodes.",
      description:
        "Suggests addresses as people type (US Autocomplete Pro) and verifies the one they pick (US Street API): USPS standardization, DPV deliverability and vacancy, ZIP+4, county and FIPS, coordinates with their precision, and the SmartyKey that keys the address registry. Needs a Smarty account with secret keys.",
      capabilities: [
        "Autocomplete",
        "USPS verification (CASS, DPV)",
        "ZIP+4, county and FIPS",
        "Rooftop geocodes",
        "SmartyKey",
      ],
      configSchema: smartyConfig,
      secrets: [
        {
          key: "authId",
          label: "Auth ID",
          description: "A secret key pair from Smarty's API keys page.",
        },
        { key: "authToken", label: "Auth token" },
      ],
      docsUrl: "https://www.smarty.com/docs/cloud/us-street-api",
      logo: { mark: "S" },
      testMode: false,
      liveMode: true,
      certified: false,
      builtin: false,
      requiresCredentials: true,
      webhook: null,
    },
    create,
    async check(settings) {
      const result = await create(settings).verify!(SAMPLE, { signal: AbortSignal.timeout(8000) });

      return result.status === "verified"
        ? {
            ok: true,
            detail: `Verified a sample address (${result.providerAddressId ?? "no SmartyKey"})`,
          }
        : { ok: false, detail: "Smarty answered but didn't verify the sample address" };
    },
  };
}

const geoapifyConfig = z.object({});

export function geoapifyProvider(fetchImpl: typeof fetch = fetch): ProviderPackage<"address"> {
  const create = (settings: ProviderSettings): AddressProvider =>
    createGeoapifyAutocomplete("geoapify", { apiKey: settings.secrets.apiKey ?? "" }, fetchImpl);

  return {
    manifest: {
      id: "geoapify",
      name: "Geoapify",
      vendor: "Geoapify",
      category: "address",
      summary: "Low-cost typing suggestions in front of your verification provider.",
      description:
        "Suggests addresses as people type, from OpenStreetMap and OpenAddresses data. Suggestions only: the address someone picks is verified by your verifying address provider before it's stored, and nothing from Geoapify is kept.",
      capabilities: ["Autocomplete"],
      configSchema: geoapifyConfig,
      secrets: [{ key: "apiKey", label: "API key" }],
      docsUrl: "https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/",
      logo: { mark: "G" },
      testMode: false,
      liveMode: true,
      certified: false,
      builtin: false,
      requiresCredentials: true,
      webhook: null,
    },
    create,
    async check(settings) {
      const suggestions = await create(settings).suggest!(
        { text: "4600 Silver Hill", country: "US", limit: 1 },
        { signal: AbortSignal.timeout(8000) },
      );

      return suggestions.length > 0
        ? { ok: true, detail: "Got suggestions for a sample address" }
        : { ok: false, detail: "No suggestions for the sample address" };
    },
  };
}
