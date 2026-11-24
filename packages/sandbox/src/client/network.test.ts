import { describe, expect, it } from "vitest";
import { guardedFetch, hostAllowed, isPublicAddress } from "./network";

const get = (url: string) => ({ url, method: "GET", headers: {}, body: null });

describe("extension network guard", () => {
  it("matches allowed hosts exactly or by subdomain wildcard", () => {
    expect(hostAllowed("api.example.com", ["api.example.com"])).toBe(true);
    expect(hostAllowed("API.example.com", ["api.example.com"])).toBe(true);
    expect(hostAllowed("evil-api.example.com", ["api.example.com"])).toBe(false);
    expect(hostAllowed("a.example.com", ["*.example.com"])).toBe(true);
    expect(hostAllowed("example.com", ["*.example.com"])).toBe(false);
    expect(hostAllowed("example.com.evil.test", ["*.example.com"])).toBe(false);
  });

  it("treats loopback, private, link-local and mapped addresses as non-public", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "0.0.0.0",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }

    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:4700::1111")).toBe(true);
  });

  it("refuses non-https, unlisted hosts, private literals and names that resolve privately", async () => {
    const policy = { allowedHosts: ["localhost", "127.0.0.1", "[::1]", "::1", "api.example.com"] };

    await expect(guardedFetch(get("http://api.example.com/"), policy)).rejects.toThrow(/https/);

    await expect(guardedFetch(get("https://other.example.com/"), policy)).rejects.toThrow(
      /allowed hosts/,
    );

    await expect(guardedFetch(get("https://127.0.0.1/"), policy)).rejects.toThrow(/public/);
    await expect(guardedFetch(get("https://[::1]/"), policy)).rejects.toThrow(/public/);
    await expect(guardedFetch(get("https://localhost/"), policy)).rejects.toThrow(/non-public/);

    await expect(guardedFetch(get("https://user:pw@api.example.com/"), policy)).rejects.toThrow(
      /credentials/,
    );
  });
});
