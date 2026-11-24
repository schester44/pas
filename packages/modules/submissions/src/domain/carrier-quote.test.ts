import { asId, type Clock, Money } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { type CarrierQuoteState, pendingCarrierQuote } from "./carrier-quote";
import { Quote } from "./quote";
import type { QuoteEvaluation } from "./quote-evaluation";
import type { UnderwritingReason } from "./underwriting";

const clock: Clock = {
  now: () => Temporal.Instant.from("2026-11-24T12:00:00Z"),
  today: () => Temporal.PlainDate.from("2026-11-24"),
};

const reviewWithin = Temporal.Duration.from({ hours: 24 });
const usd = (amount: string) => Money.of(amount, "USD");

const evaluation = (
  carrier: CarrierQuoteState,
  written: string,
  reasons: UnderwritingReason[] = [],
): QuoteEvaluation => ({
  outcome: reasons.length > 0 ? "referred" : "quoted",
  reasons,
  offers: [],
  premium: written === "0" ? [] : [{ coverage: "dwelling", premium: usd(written) }],
  writtenPremium: usd(written),
  taxesFees: [],
  total: usd(written),
  rating: null,
  decisions: [],
  diligentSearch: null,
  attestations: [],
  payPlans: [],
  carrier,
  evaluatedAt: clock.now(),
  durationMs: 0,
});

const quoteAwaiting = (carrier: CarrierQuoteState, written = "0") =>
  Quote.create(
    {
      tenantId: asId("tenant"),
      submissionId: asId("submission"),
      submissionNumber: "SUB-1",
      productReleaseId: "release",
      termStart: Temporal.PlainDate.from("2026-12-01"),
      termEnd: Temporal.PlainDate.from("2027-12-01"),
      riskData: {},
      selection: [],
      evaluation: evaluation(carrier, written),
      timing: { expiresAt: Temporal.Instant.from("2026-12-24T00:00:00Z"), reviewWithin },
      actor: { type: "system", name: "test" },
    },
    clock,
  );

const price = { lines: [{ coverage: "dwelling", amount: "1200.00" }], taxesFees: [] };
const answered = { status: "quoted" as const, reference: "C-1", messages: [], price };

describe("carrier quotes", () => {
  it("has no price until a rating carrier answers, then carries the carrier's", () => {
    const pending = pendingCarrierQuote({
      carrier: "acme",
      rating: "carrier",
      lineItems: "carrier",
    });

    const quote = quoteAwaiting(pending);

    expect(quote.pullActivity().at(-1)?.summary).toBe("Quoted; waiting for the carrier's price");

    quote.applyCarrierQuote(
      answered,
      evaluation({ ...pending, status: "quoted", price }, "1200.00"),
      reviewWithin,
      clock,
    );

    const { status, evaluation: priced } = quote.toSnapshot();

    expect(status).toBe("quoted");
    expect(priced.total.equals(usd("1200.00"))).toBe(true);
    expect(priced.carrier?.status).toBe("quoted");
  });

  it("refers the quote when the carrier's answer brings a referral reason", () => {
    const pending = pendingCarrierQuote({
      carrier: "acme",
      rating: "pas_confirmed",
      lineItems: "pas",
    });

    const quote = quoteAwaiting(pending, "1100.00");

    const mismatch: UnderwritingReason = {
      source: "carrier",
      decision: "carrier.acme",
      rule: "premium_mismatch",
      outcome: "refer",
      reasonCode: "carrier_premium_mismatch",
      message: "acme's premium differs from our rating",
    };

    quote.applyCarrierQuote(
      answered,
      evaluation({ ...pending, status: "quoted", price }, "1100.00", [mismatch]),
      reviewWithin,
      clock,
    );

    const q = quote.toSnapshot();

    expect(q.status).toBe("referred");
    expect(q.referral?.reasons.map((r) => r.reasonCode)).toEqual(["carrier_premium_mismatch"]);
    expect(quote.pullEvents().map((e) => e.type)).toContain("submissions.quote_referred");
  });
});
