import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { invalid } from "@pas/kernel";

const blocked = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];

  if (mapped) return blocked.check(mapped, "ipv4");

  const family = isIP(address);

  return family === 0 || blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

/**
 * Production webhooks must be https and resolve only to public addresses, so a tenant can't aim
 * PAS at our own network (SSRF). Sandboxes and local dev may use http and localhost.
 */
export async function assertPublicDestination(url: string, allowPrivate: boolean): Promise<void> {
  if (!URL.canParse(url)) throw invalid("Enter a full URL, like https://example.com/webhooks");

  const parsed = new URL(url);

  if (parsed.protocol !== "https:" && !(allowPrivate && parsed.protocol === "http:")) {
    throw invalid("Webhook URLs must use https");
  }

  if (parsed.username || parsed.password) throw invalid("Put credentials in headers, not the URL");

  if (allowPrivate) return;

  const host = parsed.hostname.replace(/^\[|\]$/g, "");

  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true, verbatim: true })
        .then((found) => found.map((a) => a.address))
        .catch(() => {
          throw invalid(`${host} doesn't resolve`);
        });

  if (addresses.some(isPrivateAddress)) {
    throw invalid("Webhook URLs can't point at private, loopback or link-local addresses");
  }
}
