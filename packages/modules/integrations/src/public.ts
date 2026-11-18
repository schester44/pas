export {
  INTEGRATION_CATEGORIES,
  type IntegrationCategory,
  type IntegrationEnvironment,
} from "./domain/category";
export type {
  CardPayments,
  CategoryAdapters,
  CheckoutSetup,
  DataProvider,
  EmailMessage,
  EmailSender,
  ESignProvider,
  LetterRequest,
  MailType,
  PostalAddress,
  PrintMail,
} from "./ports/adapters";
export type { MailProof, MailReference, NoticeProofs } from "./ports/mail-pieces";
export type {
  AnyProviderPackage,
  ProviderCatalog,
  ProviderManifest,
  ProviderPackage,
  ProviderSettings,
} from "./ports/provider-catalog";
export type { TenantEnvironments } from "./ports/tenant-environments";
export { ProviderResolver, type ResolverDeps } from "./application/provider-resolver";
export type { IntegrationDeps } from "./application/deps";
export type {
  IntegrationDetailDto,
  IntegrationSummaryDto,
  ConfigFieldDto,
} from "./application/dto";
export { makeListIntegrations, type ListIntegrations } from "./application/list-integrations";
export { makeGetIntegration, type GetIntegration } from "./application/get-integration";
export {
  makeConfigureIntegration,
  type ConfigureIntegration,
  type ConfigureIntegrationInput,
} from "./application/configure-integration";
export {
  makeSetIntegrationStatus,
  type SetIntegrationStatus,
} from "./application/set-integration-status";
export {
  makeTestIntegration,
  type HealthCheckDto,
  type TestIntegration,
} from "./application/test-integration";
export { makeHandleWebhook, type HandleWebhook } from "./application/handle-webhook";
export { makeSendLetter, type SendLetter } from "./application/send-letter";
