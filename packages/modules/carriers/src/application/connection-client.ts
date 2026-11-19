import { isRecord, type TenantContext } from "@pas/kernel";
import { type CarrierConnection, type SecretField, secretContext } from "../domain/connection";
import type { HttpResult, OutgoingRequest } from "../ports/flow-io";
import type { WireRequest } from "../ports/services";
import type { CarrierDeps } from "./deps";

const REDACTED = "[redacted]";

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "proxy-authorization",
]);

const SENSITIVE_KEYS = /token|secret|password|api[_-]?key|authorization/i;
const TOKEN_MARGIN_MS = 30_000;

/** HTTP through one connection: credentials applied, OAuth2 tokens cached, payloads redacted. */
export function connectionClient(
  deps: Pick<CarrierDeps, "secrets" | "http" | "tokens" | "clocks">,
  ctx: TenantContext,
  connection: CarrierConnection,
) {
  const secret = (field: SecretField): string => {
    const sealed = connection.secrets[field];

    if (!sealed) throw new Error(`The ${connection.environment} connection has no ${field} saved`);

    return deps.secrets.open(sealed, secretContext(connection, field));
  };

  const known = (): string[] =>
    (Object.keys(connection.secrets) as SecretField[])
      .flatMap((field) => {
        try {
          return [secret(field)];
        } catch {
          return [];
        }
      })
      .filter((value) => value.length >= 6);

  const now = () => deps.clocks.forTenant(ctx.tenantId).now().epochMilliseconds;

  const oauthToken = async (
    auth: Extract<CarrierConnection["auth"], { kind: "oauth2_client_credentials" }>,
  ) => {
    const cached = deps.tokens.get(connection.id);

    if (cached && cached.expiresAt - TOKEN_MARGIN_MS > now()) return cached.token;

    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: auth.clientId,
      client_secret: secret("clientSecret"),
      ...(auth.scope && { scope: auth.scope }),
    });

    const result = await deps.http.send({
      method: "POST",
      url: auth.tokenUrl,
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: form.toString(),
      timeoutMs: 15_000,
    });

    const body = result.ok && isRecord(result.response.body) ? result.response.body : {};

    if (!result.ok || result.response.status >= 300 || typeof body.access_token !== "string") {
      throw new Error(
        result.ok
          ? `The token endpoint answered ${result.response.status}`
          : `Token request failed: ${result.error}`,
      );
    }

    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;

    deps.tokens.set(connection.id, {
      token: body.access_token,
      expiresAt: now() + expiresIn * 1000,
    });

    return body.access_token;
  };

  const authorize = async (
    headers: Record<string, string>,
  ): Promise<Pick<WireRequest, "headers" | "tls">> => {
    const auth = connection.auth;

    switch (auth.kind) {
      case "none":
        return { headers };
      case "api_key":
        return {
          headers: {
            ...headers,
            [auth.header.toLowerCase()]: `${auth.prefix ?? ""}${secret("apiKey")}`,
          },
        };
      case "basic":
        return {
          headers: {
            ...headers,
            authorization: `Basic ${Buffer.from(`${auth.username}:${secret("password")}`).toString("base64")}`,
          },
        };
      case "oauth2_client_credentials":
        return { headers: { ...headers, authorization: `Bearer ${await oauthToken(auth)}` } };
      case "mtls":
        return {
          headers,
          tls: { certificate: secret("certificate"), privateKey: secret("privateKey") },
        };
    }
  };

  const wire = async (request: OutgoingRequest): Promise<WireRequest> => {
    const body =
      request.body === undefined
        ? undefined
        : typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body);

    const base = {
      method: request.method,
      url: request.url,
      timeoutMs: request.timeoutMs,
      ...(body !== undefined && { body }),
    };

    return request.anonymous
      ? { ...base, headers: request.headers }
      : { ...base, ...(await authorize(request.headers)) };
  };

  const send = async (request: OutgoingRequest): Promise<HttpResult> => {
    try {
      return await deps.http.send(await wire(request));
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: 0,
      };
    }
  };

  const download = async (url: string) =>
    deps.http.download(
      await wire({
        method: "GET",
        url,
        headers: { accept: "application/pdf" },
        timeoutMs: 30_000,
        anonymous: false,
      }),
    );

  const redact = <T>(value: T): T => {
    const secrets = known();

    const walk = (node: unknown, key?: string): unknown => {
      if (key && SENSITIVE_KEYS.test(key) && typeof node === "string") return REDACTED;

      if (typeof node === "string")
        return secrets.reduce((text, s) => text.split(s).join(REDACTED), node);

      if (Array.isArray(node)) return node.map((item) => walk(item));

      if (isRecord(node)) {
        return Object.fromEntries(
          Object.entries(node).map(([k, v]) => [
            k,
            SENSITIVE_HEADERS.has(k.toLowerCase()) ? REDACTED : walk(v, k),
          ]),
        );
      }

      return node;
    };

    return walk(value) as T;
  };

  return { send, download, redact, connection };
}

export type ConnectionClient = ReturnType<typeof connectionClient>;
