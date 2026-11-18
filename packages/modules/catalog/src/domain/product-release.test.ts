import { asId, type Jurisdiction, jurisdiction, parseInstant, parsePlainDate } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import type { DateWindow } from "./availability";
import { ProductRelease, type ReleaseManifest, selectRelease } from "./product-release";

const illinois = jurisdiction("US", "US-IL");
const indiana = jurisdiction("US", "US-IN");

const window = (from: string, to?: string): DateWindow =>
  to ? { from: parsePlainDate(from), to: parsePlainDate(to) } : { from: parsePlainDate(from) };

function release(
  version: string,
  where: Jurisdiction,
  newBusiness: DateWindow,
  renewal: DateWindow,
): ProductRelease {
  return ProductRelease.restore({
    id: asId(`release-${version}-${where.subdivision}`),
    tenantId: asId("tenant"),
    productId: asId("product"),
    productVersionId: asId(`version-${version}`),
    version,
    jurisdiction: where,
    newBusiness,
    renewal,
    manifest: {} as ReleaseManifest,
    contentHash: "",
    publishedAt: parseInstant("2026-11-01T00:00:00Z"),
  });
}

describe("selectRelease", () => {
  const releases = [
    release("2027.1", illinois, window("2027-01-01"), window("2027-02-01")),
    release("2027.2", illinois, window("2027-07-01", "2028-01-01"), window("2027-09-01")),
  ];

  const resolve = (where: Jurisdiction, date: string, kind: "new_business" | "renewal") =>
    selectRelease(releases, where, parsePlainDate(date), kind)?.toSnapshot().version ?? null;

  it("treats from as inclusive and to as exclusive", () => {
    expect(resolve(illinois, "2026-12-31", "new_business")).toBeNull();
    expect(resolve(illinois, "2027-01-01", "new_business")).toBe("2027.1");
    expect(resolve(illinois, "2027-12-31", "new_business")).toBe("2027.2");
    expect(resolve(illinois, "2028-01-01", "new_business")).toBe("2027.1");
  });

  it("picks the latest-starting window that contains the date", () => {
    expect(resolve(illinois, "2027-06-30", "new_business")).toBe("2027.1");
    expect(resolve(illinois, "2027-07-01", "new_business")).toBe("2027.2");
  });

  it("uses the renewal window for renewals", () => {
    expect(resolve(illinois, "2027-01-15", "renewal")).toBeNull();
    expect(resolve(illinois, "2027-08-01", "renewal")).toBe("2027.1");
    expect(resolve(illinois, "2027-08-01", "new_business")).toBe("2027.2");
    expect(resolve(illinois, "2027-09-01", "renewal")).toBe("2027.2");
  });

  it("finds nothing where the product isn't available", () => {
    expect(resolve(indiana, "2027-07-01", "new_business")).toBeNull();
  });
});
