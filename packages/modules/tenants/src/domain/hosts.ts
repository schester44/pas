import { invalid } from "@pas/kernel";

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const RESERVED_SUBDOMAINS = new Set(["www", "app", "admin", "api", "platform", "auth", "static"]);

export function normalizeHost(host: string): string {
  let value = host.trim().toLowerCase();

  if (value.startsWith("[")) return value; // IPv6 literal: never a tenant host

  const colon = value.lastIndexOf(":");

  if (colon !== -1) value = value.slice(0, colon);

  return value.endsWith(".") ? value.slice(0, -1) : value;
}

export function parseSubdomain(value: string): string {
  const subdomain = value.trim().toLowerCase();

  if (!LABEL.test(subdomain)) {
    throw invalid(
      "Use 1–63 lowercase letters, digits or dashes, starting and ending with a letter or digit",
      {
        field: "appSubdomain",
      },
    );
  }

  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    throw invalid(`"${subdomain}" is reserved. Choose another subdomain.`, {
      field: "appSubdomain",
    });
  }

  return subdomain;
}

export function subdomainFromSlug(slug: string): string {
  return (
    slug
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63)
      .replace(/-+$/, "") || "tenant"
  );
}

export function parseCustomDomain(value: string): string {
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  const labels = hostname.split(".");

  const valid =
    hostname.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => LABEL.test(label)) &&
    !/^\d+$/.test(labels.at(-1) ?? "");

  if (!valid) {
    throw invalid(`"${value}" isn't a valid domain. Use a hostname like quotes.example.com`, {
      field: "customDomains",
      value,
    });
  }

  return hostname;
}

export type HostMatch =
  | { kind: "base" }
  | { kind: "subdomain"; subdomain: string }
  | { kind: "custom"; hostname: string };

export class AppHosts {
  private readonly protocol: string;
  private readonly baseHost: string;
  private readonly port: string;

  constructor(appOrigin: string) {
    const url = new URL(appOrigin);
    this.protocol = url.protocol;
    this.baseHost = url.hostname.toLowerCase();
    this.port = url.port;
  }

  classify(host: string): HostMatch {
    const hostname = normalizeHost(host);

    if (hostname === this.baseHost) return { kind: "base" };

    const suffix = `.${this.baseHost}`;

    if (hostname.endsWith(suffix)) {
      const subdomain = hostname.slice(0, -suffix.length);

      if (LABEL.test(subdomain)) return { kind: "subdomain", subdomain };
    }

    return { kind: "custom", hostname };
  }

  urlsFor(subdomain: string, customDomains: readonly string[]): string[] {
    const port = this.port ? `:${this.port}` : "";

    return [
      `${this.protocol}//${subdomain}.${this.baseHost}${port}`,
      ...customDomains.map((domain) => `https://${domain}`),
    ];
  }
}
