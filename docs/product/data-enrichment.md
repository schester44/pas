# Data enrichment

**Each product pulls the third-party data it needs while quoting (replacement cost, hazard scores, property details), reshapes it, and feeds it to underwriting and rating, with the vendor's report kept on the quote.**

## The problem

Replacement cost estimates and hazard scores drive dwelling limits, eligibility and price, yet in most systems they're either typed in by the agent from a separate vendor portal or wired into rating by custom code per carrier. Nobody can tell later which number the premium used, and the vendor's report lives in someone's downloads folder.

## How it works

Each product version has a **Data** tab. It lists:

- **Sources**: which data the product needs (replacement cost, hazards, property characteristics, geocode, tax jurisdiction), when it's pulled (before rating today; at address entry, before binding and at renewal as those stages arrive), and the providers to ask, in fallback order. Each source maps risk fields to the request; fields like square footage can be optional so the vendor estimates without them.
- **Calculated values**: expressions over the data, such as `round(call.rce.insurableReplacementCost / 1000) * 1000`, with a live sample result.
- **Transforms**: custom TypeScript, run as a sandboxed extension, that reshapes provider data before it's stored.
- **Mappings**: where provider data and calculated values land on the risk. Rating, rules and documents read those fields like any other. A value the agent typed is never replaced; the difference is recorded as a discrepancy that underwriting rules can refer on.
- **Reports**: the provider's own PDF (like a replacement cost report), or one generated from a **Data report** template designed in Documents, or the provider's with a generated fallback.

Publishing checks every mapping, source and expression against the risk schema and pins the transform versions.

## What agents and underwriters see

The quote's **Property data** panel shows what each provider returned, the cost breakdown, calculated values, anything that disagrees with what was entered, and the reports to download. Underwriters see the same panel on the submission and referral. When the policy binds, the reports join its documents.

## Every run is kept

Each run is stored as returned, along with what the transforms and expressions produced and what was applied. Re-quoting, customizing coverages and binding reuse it while the risk is unchanged, so the same data is never bought twice and a quote always explains its premium.

## Testing

Install **Mock data** from Settings → Integrations to test without vendor accounts. It answers every kind of data, pins answers for addresses you list, simulates slow, failing, partial and conflicting providers, and returns a sample report. In sandboxes it answers for any provider a product names. `pnpm --filter @pas/api seed:enrichment` publishes a demo Homeowners Coastal version with replacement cost and hazards and quotes it once.
