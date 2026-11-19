import {
  createFakeAddressProvider,
  registryKey,
  standardizeOffline,
  textKey,
  type AddressInput,
} from "@pas/addressing";
import { asId, systemClock } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { AddressRecord } from "./address-record";
import { decideResolution } from "./resolution";

const tenant = asId<"Tenant">("t1");
const fake = createFakeAddressProvider();
const signal = new AbortController().signal;

/** A registry in memory: the same lookups the use case makes, then the decision. */
function registry() {
  const records: AddressRecord[] = [];

  return {
    records,
    async resolve(input: AddressInput, verify = true) {
      const verification = verify
        ? await fake.verify!(input, { signal })
        : standardizeOffline(input);

      const texts = new Set([textKey(verification.address), textKey(input)]);

      const decision = decideResolution({
        verification,
        byKey: records.find((r) => r.key === registryKey(verification)) ?? null,
        byText: records.filter((r) => texts.has(r.toSnapshot().textKey)),
      });

      if (decision.kind === "create") {
        const record = AddressRecord.fromVerification(tenant, verification, systemClock);
        records.push(record);

        return record;
      }

      decision.record.verifiedAgain(verification, systemClock);

      return decision.record;
    },
  };
}

const elmwood = {
  line1: "1420 Elmwood Ave",
  city: "Evanston",
  region: "IL",
  postalCode: "60201",
  country: "US",
};

describe("address dedupe", () => {
  it("lands the same address in different formatting on one record", async () => {
    const r = registry();
    const a = await r.resolve(elmwood);

    const b = await r.resolve({
      ...elmwood,
      line1: "1420 ELMWOOD AVENUE",
      city: "evanston",
      postalCode: "60201-0000",
    });

    expect(b.id).toBe(a.id);
    expect(r.records).toHaveLength(1);
  });

  it("keeps different units of one building apart", async () => {
    const r = registry();
    const tower = { ...elmwood, line1: "1600 Chicago Ave" };
    const twoB = await r.resolve({ ...tower, line2: "Apt 2B" });
    const threeA = await r.resolve({ ...tower, line2: "Unit 3A" });
    const twoBAgain = await r.resolve({ ...tower, line1: "1600 Chicago Avenue #2b" });

    expect(threeA.id).not.toBe(twoB.id);
    expect(twoBAgain.id).toBe(twoB.id);
  });

  it("upgrades an unverified record when the address later verifies, and reuses it after", async () => {
    const r = registry();
    const entered = await r.resolve(elmwood, false);
    const verified = await r.resolve(elmwood);
    const typedAgain = await r.resolve({ ...elmwood, line1: "1420 elmwood avenue" }, false);

    expect(verified.id).toBe(entered.id);
    expect(verified.verified).toBe(true);
    expect(typedAgain.id).toBe(entered.id);
    expect(r.records).toHaveLength(1);
  });
});
