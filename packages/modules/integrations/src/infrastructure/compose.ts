import type { PrismaClient } from "@pas/db";
import type { ClockProvider, Outbox, UnitOfWork } from "@pas/kernel";
import { makeConfigureIntegration } from "../application/configure-integration";
import type { IntegrationDeps } from "../application/deps";
import { makeGetIntegration } from "../application/get-integration";
import { makeHandleWebhook } from "../application/handle-webhook";
import { makeListIntegrations } from "../application/list-integrations";
import { ProviderResolver } from "../application/provider-resolver";
import { makeSendLetter } from "../application/send-letter";
import { makeSetIntegrationStatus } from "../application/set-integration-status";
import { makeTestIntegration } from "../application/test-integration";
import type { NoticeProofs } from "../ports/mail-pieces";
import type { AnyProviderPackage } from "../ports/provider-catalog";
import type { TenantEnvironments } from "../ports/tenant-environments";
import { AesSecretBox } from "./aes-secret-box";
import { PrismaInstallRepository } from "./prisma-install-repository";
import { PrismaIntegrationEvents } from "./prisma-integration-events";
import { PrismaMailPieces } from "./prisma-mail-pieces";
import { StaticProviderCatalog } from "./provider-catalog";
import { externalBillingProvider } from "./providers/billing-events";
import { geoapifyProvider, smartyProvider } from "./providers/addresses";
import { censusGeocoderProvider } from "./providers/builtin";
import { e2valueProvider, hazardhubProvider } from "./providers/data-vendors";
import {
  fileExportFilingProvider,
  slaiFilingProvider,
  testFilingProvider,
} from "./providers/filing";
import { lobProvider } from "./providers/lob";
import { postmarkProvider } from "./providers/postmark";
import { resendProvider } from "./providers/resend";
import { smtpProvider } from "./providers/smtp";
import { stripeProvider } from "./providers/stripe";
import { webhookEmailProvider, webhookPrintMailProvider } from "./providers/webhook";

/** The catalog, resolver and use cases, shared by the api and worker composition roots. */
export function composeIntegrations(deps: {
  prisma: PrismaClient;
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  environments: TenantEnvironments;
  builtins: readonly AnyProviderPackage[];
  notices: NoticeProofs;
  secretKey: string | undefined;
  /** The API's public origin, for webhook URLs. */
  publicUrl: string;
}) {
  const catalog = new StaticProviderCatalog([
    ...deps.builtins,
    stripeProvider,
    resendProvider(),
    postmarkProvider(),
    smtpProvider,
    lobProvider(),
    webhookEmailProvider(),
    webhookPrintMailProvider(),
    externalBillingProvider(),
    censusGeocoderProvider,
    e2valueProvider(),
    hazardhubProvider(),
    smartyProvider(),
    geoapifyProvider(),
    testFilingProvider,
    fileExportFilingProvider,
    slaiFilingProvider,
  ]);

  const installs = new PrismaInstallRepository(deps.prisma);
  const events = new PrismaIntegrationEvents();
  const mail = new PrismaMailPieces();
  const secrets = new AesSecretBox(deps.secretKey);

  const webhookUrl = (install: { id: string; providerId: string }) => {
    const kind = catalog.get(install.providerId)?.manifest.webhook?.kind;

    return kind ? new URL(`/api/webhooks/${kind}/${install.id}`, deps.publicUrl).toString() : null;
  };

  const resolver = new ProviderResolver({
    uow: deps.uow,
    installs,
    events,
    catalog,
    secrets,
    environments: deps.environments,
    webhookUrl,
    clocks: deps.clocks,
    ticks: () => performance.now(),
  });

  const shared: IntegrationDeps = {
    uow: deps.uow,
    outbox: deps.outbox,
    installs,
    events,
    catalog,
    secrets,
    resolver,
    clocks: deps.clocks,
  };

  return {
    resolver,
    catalog,
    list: makeListIntegrations(shared),
    get: makeGetIntegration({ ...shared, webhookUrl }),
    configure: makeConfigureIntegration(shared),
    setStatus: makeSetIntegrationStatus(shared),
    test: makeTestIntegration(shared),
    handleWebhook: makeHandleWebhook({ ...shared, mail, notices: deps.notices }),
    sendLetter: makeSendLetter({ ...shared, mail, notices: deps.notices }),
  };
}

export type Integrations = ReturnType<typeof composeIntegrations>;
