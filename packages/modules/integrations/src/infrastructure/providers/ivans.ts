import {
  type AgencyDownloadChannel,
  type DownloadSettings,
  parseCodeMap,
  type TransactionKind,
} from "@pas/agency-downloads";
import { DomainError } from "@pas/kernel";
import { z } from "zod";
import type { ProviderPackage, ProviderSettings } from "../../ports/provider-catalog";

const send = (title: string) => z.boolean().default(true).meta({ title });

const config = z.object({
  participantCode: z.string().trim().max(20).default("").meta({
    title: "Participant code",
    description: "Your carrier or MGA code with IVANS.",
  }),
  format: z
    .enum(["acord_xml", "al3"])
    .default("acord_xml")
    .meta({
      title: "File format",
      optionLabels: { acord_xml: "ACORD XML", al3: "ACORD AL3 (placeholder, not certified)" },
    }),
  batchTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("02:00")
    .meta({ title: "Nightly batch time", description: "24-hour time, e.g. 02:00." }),
  timeZone: z
    .string()
    .refine((zone) => {
      try {
        return (
          new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone !== ""
        );
      } catch {
        return false;
      }
    })
    .default("America/Chicago")
    .meta({ title: "Time zone", description: "IANA time zone of the batch time." }),
  newBusiness: send("Send new business"),
  endorsements: send("Send endorsements"),
  cancellations: send("Send cancellations"),
  reinstatements: send("Send reinstatements"),
  renewals: send("Send renewals"),
  documents: z.boolean().default(false).meta({
    title: "Attach documents",
    description: "Adds each transaction's declarations and notices as PDFs.",
  }),
  commissionStatements: z.boolean().default(true).meta({
    title: "Send commission statements",
    description: "Each enrolled agency's statement for the month, with the first batch after it.",
  }),
  lobCodes: z.string().max(2000).default("").meta({
    title: "Line of business codes",
    description: "Your line of business = ACORD LOB code, comma-separated, e.g. homeowners=HOME.",
  }),
  coverageCodes: z.string().max(4000).default("").meta({
    title: "Coverage codes",
    description: "Your coverage code = ACORD coverage code, e.g. dwelling=DWELL.",
  }),
});

const KINDS: [keyof z.infer<typeof config>, TransactionKind][] = [
  ["newBusiness", "new_business"],
  ["endorsements", "endorsement"],
  ["cancellations", "cancellation"],
  ["reinstatements", "reinstatement"],
  ["renewals", "renewal"],
];

export function downloadSettings(settings: ProviderSettings): DownloadSettings {
  const c = config.parse(settings.config);

  return {
    participantCode: c.participantCode,
    format: c.format,
    batchTime: c.batchTime,
    timeZone: c.timeZone,
    transactionKinds: KINDS.filter(([key]) => c[key]).map(([, kind]) => kind),
    documents: c.documents,
    commissionStatements: c.commissionStatements,
    lobCodes: parseCodeMap(c.lobCodes),
    coverageCodes: parseCodeMap(c.coverageCodes),
  };
}

const NOT_CERTIFIED =
  "Delivery to the IVANS network needs IVANS onboarding and certification first; use test mode to deliver to the test mailbox";

/*
 * IVANS Download (Applied Systems), from public information only (docs/research/vendors.md §3).
 * Test mode delivers to the built-in test mailbox, where every file can be read back. Live
 * delivery needs IVANS to certify the carrier/MGA and issue transport credentials; until then the
 * live transport refuses to send rather than guess at an unpublished interface.
 */
export const ivansDownloadProvider: ProviderPackage<"agency_downloads"> = {
  manifest: {
    id: "ivans_download",
    name: "IVANS Download",
    vendor: "IVANS",
    category: "agency_downloads",
    summary:
      "Sends each issued transaction and commission statement to the agency's management system overnight.",
    description:
      "Builds an ACORD record for every issued transaction of an enrolled agency and delivers a nightly file to the agency's IVANS mailbox, with resends and a certification test harness. Test mode delivers to a built-in test mailbox you can inspect. Live delivery needs IVANS onboarding and carrier certification, which can take months.",
    capabilities: [
      "ACORD XML downloads",
      "Nightly batches per agency mailbox",
      "Direct-bill commission statements",
      "Resend a file or a transaction",
      "Certification sample files",
    ],
    configSchema: config,
    secrets: [
      {
        key: "username",
        label: "Transport user ID",
        description: "Issued by IVANS at certification.",
        optional: true,
      },
      {
        key: "password",
        label: "Transport password",
        description: "Issued by IVANS at certification.",
        optional: true,
      },
    ],
    docsUrl: "https://www.ivans.com/for-mgas/products/ivans-download/",
    logo: { mark: "I" },
    testMode: true,
    liveMode: true,
    certified: false,
    builtin: false,
    webhook: null,
    requiresCredentials: true,
  },
  create: (settings): AgencyDownloadChannel => {
    const test = settings.environment === "test";

    return {
      provider: "ivans_download",
      name: test ? "IVANS Download (test mailbox)" : "IVANS Download",
      transport: test ? "test_mailbox" : "ivans",
      test,
      settings: downloadSettings(settings),
      deliver: async (_ctx, file) => {
        if (!test) throw new DomainError("precondition_failed", NOT_CERTIFIED);

        const mailbox = file.mailbox ? `${file.accountCode}/${file.mailbox}` : file.accountCode;

        return { reference: `TESTMBX-${mailbox}-${file.fileId.slice(-8).toUpperCase()}` };
      },
    };
  },
  check: async (settings) => {
    if (settings.environment === "test") {
      return { ok: true, detail: "Test mode delivers to the built-in test mailbox" };
    }

    if (!settings.secrets.username || !settings.secrets.password) {
      return { ok: false, detail: "Add the transport credentials IVANS issues at certification" };
    }

    return { ok: false, detail: "Live delivery isn't available until IVANS certification" };
  },
};
