import type { Id, Instant, TenantId } from "@pas/kernel";
import type { CarrierEnvironment, CarrierId } from "./carrier";

export type ConnectionId = Id<"CarrierConnection">;

export type ConnectionAuth =
  | { kind: "none" }
  | { kind: "api_key"; header: string; prefix?: string }
  | { kind: "basic"; username: string }
  | { kind: "oauth2_client_credentials"; tokenUrl: string; clientId: string; scope?: string }
  | { kind: "mtls" };

export const SECRET_FIELDS = [
  "apiKey",
  "password",
  "clientSecret",
  "certificate",
  "privateKey",
  "callbackSecret",
] as const;

export type SecretField = (typeof SECRET_FIELDS)[number];

export interface SealedSecret {
  keyId: string;
  iv: string;
  data: string;
  tag: string;
}

export interface CallbackSettings {
  signature: "none" | "hmac_sha256";
  header: string;
}

export interface CarrierConnection {
  id: ConnectionId;
  tenantId: TenantId;
  carrierId: CarrierId;
  environment: CarrierEnvironment;
  baseUrl: string;
  auth: ConnectionAuth;
  secrets: Partial<Record<SecretField, SealedSecret>>;
  secretHints: Partial<Record<SecretField, string>>;
  callback: CallbackSettings;
  createdAt: Instant;
  updatedAt: Instant;
}

/** Which sealed secrets each auth kind needs (the callback secret is separate). */
export const SECRETS_FOR: Record<ConnectionAuth["kind"], SecretField[]> = {
  none: [],
  api_key: ["apiKey"],
  basic: ["password"],
  oauth2_client_credentials: ["clientSecret"],
  mtls: ["certificate", "privateKey"],
};

export const hintOf = (field: SecretField, value: string): string =>
  field === "certificate" || field === "privateKey"
    ? `${value.length} characters`
    : value.length <= 4
      ? "••••"
      : `••••${value.slice(-4)}`;

export const secretContext = (connection: { tenantId: string; id: string }, field: SecretField) =>
  `carrier:${connection.tenantId}:${connection.id}:${field}`;
