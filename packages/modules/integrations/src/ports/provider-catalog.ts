import type { Instant } from "@pas/kernel";
import type { z } from "zod";
import type { IntegrationCategory, IntegrationEnvironment } from "../domain/category";
import type { AdapterCategory, CategoryAdapters } from "./adapters";

export interface SecretField {
  key: string;
  label: string;
  description?: string;
  optional?: boolean;
}

/** A catalog entry: everything the admin needs to describe, configure and certify a provider. */
export interface ProviderManifest {
  id: string;
  name: string;
  vendor: string;
  category: IntegrationCategory;
  summary: string;
  description: string;
  capabilities: readonly string[];
  configSchema: z.ZodObject;
  secrets: readonly SecretField[];
  docsUrl: string | null;
  /** A short wordmark letter, or a neutral icon for generic and built-in providers. */
  logo: { mark?: string; icon?: string };
  testMode: boolean;
  liveMode: boolean;
  certified: boolean;
  builtin: boolean;
  webhook: { kind: string; events: readonly string[] } | null;
  /** Data providers: the enrichment capabilities it answers. */
  supplies?: readonly string[];
  /** Needs an account and credentials issued by the vendor. */
  requiresCredentials?: boolean;
}

/** An install's resolved settings, with secrets decrypted. Never leaves the server. */
export interface ProviderSettings {
  installId: string | null;
  tenantId: string;
  environment: IntegrationEnvironment;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  webhookUrl: string | null;
}

export interface HealthResult {
  ok: boolean;
  detail: string;
}

export type WebhookEvent =
  | {
      kind: "payment";
      externalId: string;
      type: string;
      paymentRef: string | null;
      summary: string;
      data: Record<string, unknown>;
    }
  | {
      kind: "mail_tracking";
      externalId: string;
      providerRef: string;
      status: string;
      trackingNumber: string | null;
      occurredAt: Instant;
      /** The event proves the piece entered the mail stream (PLAN §17.3). */
      proofOfMailing: boolean;
      summary: string;
      data: Record<string, unknown>;
    }
  | {
      kind: "email_status";
      externalId: string;
      providerRef: string;
      status: string;
      summary: string;
      data: Record<string, unknown>;
    }
  | { kind: "ping"; externalId: string; summary: string };

export interface InboundWebhook {
  rawBody: string;
  headers: Headers;
}

export interface ProviderPackage<C extends AdapterCategory = AdapterCategory> {
  manifest: ProviderManifest & { category: C };
  create(settings: ProviderSettings): CategoryAdapters[C];
  check(settings: ProviderSettings): Promise<HealthResult>;
  /** Verifies the signature (throws when it doesn't match) and normalizes the payload. */
  webhook?(request: InboundWebhook, settings: ProviderSettings): Promise<WebhookEvent[]>;
}

export type AnyProviderPackage = { [C in AdapterCategory]: ProviderPackage<C> }[AdapterCategory];

export interface ProviderCatalog {
  list(): readonly AnyProviderPackage[];
  get(id: string): AnyProviderPackage | undefined;
  builtinFor(category: IntegrationCategory): string | null;
}
