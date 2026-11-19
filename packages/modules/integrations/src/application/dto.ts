import { z } from "zod";
import type { IntegrationCategory, IntegrationEnvironment } from "../domain/category";
import type { InstallProps, InstallStatus } from "../domain/install";
import type { IntegrationEventRecord } from "../ports/integration-events";
import type { ProviderManifest } from "../ports/provider-catalog";

export interface IntegrationSummaryDto {
  id: string;
  name: string;
  vendor: string;
  category: IntegrationCategory;
  summary: string;
  logo: ProviderManifest["logo"];
  certified: boolean;
  builtin: boolean;
  testMode: boolean;
  liveMode: boolean;
  install: { status: InstallStatus; environment: IntegrationEnvironment } | null;
  powering: boolean;
  files: { kinds: string[]; jurisdictions: string[] | "all" } | null;
  requiresCredentials: boolean;
}

export interface ConfigFieldDto {
  key: string;
  label: string;
  description: string | null;
  type: "text" | "url" | "email" | "number" | "boolean" | "select";
  options: string[];
  optional: boolean;
  defaultValue: unknown;
}

export interface IntegrationDetailDto extends IntegrationSummaryDto {
  description: string;
  capabilities: string[];
  supplies: string[];
  requiresCredentials: boolean;
  docsUrl: string | null;
  sandbox: boolean;
  configFields: ConfigFieldDto[];
  config: Record<string, unknown>;
  secrets: {
    key: string;
    label: string;
    description: string | null;
    optional: boolean;
    hint: string | null;
  }[];
  webhook: { url: string; events: string[] } | null;
  health: { checkedAt: string; ok: boolean; detail: string } | null;
  poweredBy: { id: string; name: string }[];
  activity: {
    id: string;
    kind: string;
    outcome: "ok" | "error";
    summary: string;
    occurredAt: string;
  }[];
}

export function toSummaryDto(
  manifest: ProviderManifest,
  install: Readonly<InstallProps> | undefined,
  powering: boolean,
): IntegrationSummaryDto {
  return {
    id: manifest.id,
    name: manifest.name,
    vendor: manifest.vendor,
    category: manifest.category,
    summary: manifest.summary,
    logo: manifest.logo,
    certified: manifest.certified,
    builtin: manifest.builtin,
    testMode: manifest.testMode,
    liveMode: manifest.liveMode,
    install: install ? { status: install.status, environment: install.environment } : null,
    powering,
    files: manifest.files
      ? {
          kinds: [...manifest.files.kinds],
          jurisdictions:
            manifest.files.jurisdictions === "all" ? "all" : [...manifest.files.jurisdictions],
        }
      : null,
    requiresCredentials: manifest.requiresCredentials ?? false,
  };
}

export const maskHint = (hint: string) => `••••${hint}`;

export function toActivityDto(event: IntegrationEventRecord) {
  return {
    id: event.id,
    kind: event.kind,
    outcome: event.outcome,
    summary: event.summary,
    occurredAt: event.occurredAt.toString(),
  };
}

interface JsonProperty {
  type?: string;
  format?: string;
  enum?: unknown[];
  title?: string;
  description?: string;
  default?: unknown;
}

/** The manifest's zod config schema as form fields for the admin's setup form. */
export function configFields(schema: z.ZodObject): ConfigFieldDto[] {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as {
    properties?: Record<string, JsonProperty>;
    required?: string[];
  };

  return Object.entries(json.properties ?? {}).map(([key, property]) => ({
    key,
    label: property.title ?? key,
    description: property.description ?? null,
    type: fieldType(property),
    options: (property.enum ?? []).map(String),
    optional: !(json.required ?? []).includes(key) || property.default !== undefined,
    defaultValue: property.default ?? null,
  }));
}

function fieldType(property: JsonProperty): ConfigFieldDto["type"] {
  if (property.enum) return "select";

  if (property.type === "boolean") return "boolean";

  if (property.type === "number" || property.type === "integer") return "number";

  if (property.format === "uri") return "url";

  if (property.format === "email") return "email";

  return "text";
}
