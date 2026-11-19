import { describe, expect, it } from "vitest";
import { toDownloadRecord } from "../../domain/record";
import { type SampleScenario, sampleView } from "../../domain/samples";
import { acordXmlFormat } from "./acord-xml";

const envelope = {
  fileId: "01a1f1c9-0000-7000-8000-000000000abc",
  createdAt: Temporal.Instant.from("2027-07-02T07:00:00Z"),
  sender: { participantCode: "MGA01", name: "Acme MGA" },
  recipient: { accountCode: "YAB1D", mailbox: null },
  test: true,
};

function file(scenario: SampleScenario, kind: "endorsement" | "cancellation") {
  const view = sampleView(scenario, {
    lineOfBusiness: "homeowners",
    agency: { id: "agency-1", name: "Lakeshore Insurance Group" },
  });

  const record = toDownloadRecord(view, {
    kind,
    enrollment: { accountCode: "YAB1D", agencyCodes: [{ carrier: "", code: "A100" }] },
    settings: {
      lobCodes: { homeowners: "HOME" },
      coverageCodes: { dwelling: "DWELL", personal_liability: "PL" },
    },
  });

  return acordXmlFormat.policyFile(envelope, [record], []);
}

describe("ACORD XML", () => {
  it("writes an endorsement as a HomePolicyModRq with the change and the full policy image", () => {
    const xml = file("endorsement", "endorsement");

    expect(xml).toContain("<HomePolicyModRq>");
    expect(xml).toContain("<Description>Dwelling limit: 400000 to 450000</Description>");
    expect(xml).toMatchSnapshot();
  });

  it("writes a cancellation as a HomePolicyCancelRq with the return premium", () => {
    const xml = file("cancellation", "cancellation");

    expect(xml).toContain("<HomePolicyCancelRq>");
    expect(xml).toContain("<ReturnPremiumAmt>\n");
    expect(xml).not.toContain("<HomeLineBusiness>");
    expect(xml).toMatchSnapshot();
  });
});
