import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, request } from "undici";

/** One request an extension made and what came back, kept for the ExtensionRun. */
export interface NetworkExchange {
  request: { method: string; url: string; headers: Record<string, string>; body: string | null };
  response:
    | { status: number; url: string; headers: Record<string, string>; body: string }
    | { error: string };
  durationMs: number;
}

export interface FetchArgs {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface FetchResult {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface NetworkPolicy {
  /** Hostnames the extension version declared; `*.example.com` matches subdomains only. */
  allowedHosts: readonly string[];
  /** Headers the host attaches for a URL (tenant credentials); never visible to the extension. */
  credentials?: (url: URL) => Record<string, string> | Promise<Record<string, string>>;
  /** Local dev only: permits http:// and loopback/private addresses. */
  allowPrivateNetwork?: boolean;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
}

const blocked = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];

  if (mapped) return isPublicAddress(mapped);

  const family = isIP(address);

  if (family === 0) return false;

  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

export function hostAllowed(hostname: string, allowedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  return allowedHosts.some((pattern) => {
    const p = pattern.toLowerCase();

    return p.startsWith("*.")
      ? host.endsWith(p.slice(1)) && host.length > p.length - 1
      : host === p;
  });
}

class NetworkDenied extends Error {}

const guardedAgents = new Map<boolean, Agent>();

/** Validates every resolved address at connect time, so DNS rebinding and redirects can't reach private networks. */
function agentFor(allowPrivateNetwork: boolean): Agent {
  const existing = guardedAgents.get(allowPrivateNetwork);

  if (existing) return existing;

  const agent = new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
          if (error) return callback(error, "", 0);

          const list = addresses as LookupAddress[];
          const denied = list.find((a) => !allowPrivateNetwork && !isPublicAddress(a.address));

          if (denied || list.length === 0) {
            return callback(
              new NetworkDenied(`${hostname} resolves to a non-public address`),
              "",
              0,
            );
          }

          if ((options as { all?: boolean }).all) {
            return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
          }

          const first = list[0]!;

          callback(null, first.address, first.family);
        });
      },
    },
  });

  guardedAgents.set(allowPrivateNetwork, agent);

  return agent;
}

const forbiddenRequestHeaders = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "te",
  "trailer",
  "keep-alive",
]);

const headerRecord = (headers: Record<string, string | string[] | undefined>) =>
  Object.fromEntries(
    Object.entries(headers)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(", ") : v]),
  );

function checkUrl(raw: string, policy: NetworkPolicy): URL {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new NetworkDenied(`${raw} isn't a valid URL`);
  }

  const secure = url.protocol === "https:";
  const insecureAllowed = url.protocol === "http:" && policy.allowPrivateNetwork;

  if (!secure && !insecureAllowed) throw new NetworkDenied(`Only https URLs are allowed: ${raw}`);

  if (url.username || url.password) throw new NetworkDenied("URLs can't carry credentials");

  if (!hostAllowed(url.hostname, policy.allowedHosts)) {
    throw new NetworkDenied(`${url.hostname} isn't in the extension's allowed hosts`);
  }

  const literal = url.hostname.replace(/^\[|\]$/g, "");

  if (isIP(literal) && !policy.allowPrivateNetwork && !isPublicAddress(literal)) {
    throw new NetworkDenied(`${literal} isn't a public address`);
  }

  return url;
}

async function readCapped(body: AsyncIterable<Uint8Array>, max: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;

  for await (const chunk of body) {
    size += chunk.byteLength;

    if (size > max) throw new NetworkDenied(`The response is larger than ${max} bytes`);

    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The `fetch` host function: allow-listed hosts only, public addresses only, redirects followed
 * by hand and re-checked per hop, credentials attached per hop and never returned to the caller.
 */
export async function guardedFetch(args: FetchArgs, policy: NetworkPolicy): Promise<FetchResult> {
  const timeoutMs = policy.timeoutMs ?? 10_000;
  const maxRedirects = policy.maxRedirects ?? 5;
  const maxRequestBytes = policy.maxRequestBytes ?? 1024 * 1024;
  const maxResponseBytes = policy.maxResponseBytes ?? 5 * 1024 * 1024;
  const deadline = AbortSignal.timeout(timeoutMs);
  const agent = agentFor(policy.allowPrivateNetwork ?? false);

  if (args.body !== null && Buffer.byteLength(args.body) > maxRequestBytes) {
    throw new NetworkDenied(`The request body is larger than ${maxRequestBytes} bytes`);
  }

  const ownHeaders = Object.fromEntries(
    Object.entries(args.headers)
      .map(([k, v]) => [k.toLowerCase(), String(v)] as const)
      .filter(([k]) => !forbiddenRequestHeaders.has(k)),
  );

  let url = checkUrl(args.url, policy);
  let method = args.method;
  let body = args.body;

  for (let hop = 0; ; hop += 1) {
    const injected = (await policy.credentials?.(url)) ?? {};

    const response = await request(url, {
      method: method as "GET",
      headers: { ...ownHeaders, ...injected },
      body: body ?? undefined,
      dispatcher: agent,
      signal: deadline,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });

    const location = response.headers.location;

    if (response.statusCode >= 300 && response.statusCode < 400 && typeof location === "string") {
      await response.body.dump();

      if (hop >= maxRedirects) throw new NetworkDenied(`More than ${maxRedirects} redirects`);

      url = checkUrl(new URL(location, url).toString(), policy);

      if (
        response.statusCode === 303 ||
        ((response.statusCode === 301 || response.statusCode === 302) && method === "POST")
      ) {
        method = "GET";
        body = null;
      }

      continue;
    }

    return {
      status: response.statusCode,
      url: url.toString(),
      headers: headerRecord(response.headers),
      body: await readCapped(response.body, maxResponseBytes),
    };
  }
}

const MAX_RECORDED_BODY = 64 * 1024;

/** Wraps a fetch so every exchange is recorded; injected credentials never reach the record. */
export function recordingFetch(
  fetch: (args: FetchArgs) => Promise<FetchResult>,
  record: (exchange: NetworkExchange) => void,
): (args: FetchArgs) => Promise<FetchResult> {
  return async (args) => {
    const startedAt = performance.now();
    const recorded = { ...args, body: args.body?.slice(0, MAX_RECORDED_BODY) ?? null };

    try {
      const result = await fetch(args);

      record({
        request: recorded,
        response: { ...result, body: result.body.slice(0, MAX_RECORDED_BODY) },
        durationMs: Math.round(performance.now() - startedAt),
      });

      return result;
    } catch (error) {
      record({
        request: recorded,
        response: { error: error instanceof Error ? error.message : String(error) },
        durationMs: Math.round(performance.now() - startedAt),
      });

      throw error;
    }
  };
}

/** Sandbox tenants: answer from recorded exchanges instead of the network. */
export function fixtureFetch(
  fixtures: readonly NetworkExchange[],
): (args: FetchArgs) => Promise<FetchResult> {
  return async (args) => {
    const match = fixtures.find(
      (f) =>
        f.request.method === args.method &&
        f.request.url === args.url &&
        (f.request.body ?? null) === (args.body ?? null),
    );

    if (!match) throw new Error(`No recorded response for ${args.method} ${args.url}`);

    if ("error" in match.response) throw new Error(match.response.error);

    return match.response;
  };
}
