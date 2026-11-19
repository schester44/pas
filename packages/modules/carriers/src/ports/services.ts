import type { TenantContext, WorkflowStep } from "@pas/kernel";
import type { CanonicalInput } from "../domain/canonical";
import type { SealedSecret } from "../domain/connection";
import type { Capability, HttpMethod } from "../domain/connector";
import type { FeedChannel, FeedDestination } from "../domain/feed";
import type { FeedRecord } from "../domain/feed-files";
import type { CarrierOutcome } from "../domain/outcome";
import type { HttpResponse, HttpResult } from "./flow-io";

export interface SecretBox {
  seal(plaintext: string, context: string): SealedSecret;
  open(sealed: SealedSecret, context: string): string;
}

export interface WireRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  /** Client certificate for mutual TLS. */
  tls?: { certificate: string; privateKey: string };
}

/** Raw HTTP; adapters return transport failures as `ok: false` instead of throwing. */
export interface HttpTransport {
  send(request: WireRequest): Promise<HttpResult>;
  download(
    request: WireRequest,
  ): Promise<{ ok: true; body: Uint8Array; contentType: string } | { ok: false; error: string }>;
}

export interface TokenCache {
  get(key: string): { token: string; expiresAt: number } | undefined;
  set(key: string, value: { token: string; expiresAt: number }): void;
  delete(key: string): void;
}

export interface CarrierEnvironments {
  isSandbox(ctx: TenantContext): Promise<boolean>;
}

/**
 * What a tenant extension adapter gets (PLAN §12, §15.1): HTTP through the connection's
 * credentials and durable steps, so long carrier conversations survive restarts.
 */
export interface CarrierExtensionTools {
  http(request: {
    method: HttpMethod;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  }): Promise<HttpResponse>;
  step: WorkflowStep;
  connection: { environment: string; baseUrl: string };
  callbackUrl: string;
}

/** The interface a tenant-authored carrier extension implements. */
export interface CarrierExtension {
  key: string;
  name: string;
  capabilities: Capability[];
  invoke(
    capability: Capability,
    input: CanonicalInput,
    tools: CarrierExtensionTools,
  ): Promise<CarrierOutcome>;
}

/** Where extension adapters are registered; the sandboxed runtime will load them here. */
export interface CarrierExtensionRegistry {
  get(tenantId: string, key: string): CarrierExtension | undefined;
  list(tenantId: string): CarrierExtension[];
}

/** Issued transactions for the products a carrier writes, read through policy's public API. */
export interface FeedSource {
  records(
    ctx: TenantContext,
    input: { carrierKey: string; from: string; to: string },
  ): Promise<FeedRecord[]>;
}

export interface FeedFile {
  fileName: string;
  contentType: string;
  body: Uint8Array;
}

export interface FeedChannels {
  deliver(
    ctx: TenantContext,
    input: { channel: FeedChannel; destination: FeedDestination; file: FeedFile; subject: string },
  ): Promise<{ detail: string }>;
}
