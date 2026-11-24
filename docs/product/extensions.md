# Extensions

**When configuration can't express something, tenants write a little TypeScript for it, run it in a sandbox at a named point, and pin it to the product like any other configuration.**

## The problem

Every product eventually needs one rule a decision table can't hold: a proprietary score from the tenant's own API, a rater an actuary built elsewhere, an unusual installment schedule, a short-rate penalty with a quirk. In most systems that means a vendor change order or a fork of the core, and nobody can tell later which code priced which quote.

## Where extensions run

Each extension point has a fixed input and a checked output, so an extension changes one answer and never the lifecycle around it.

| Point | What it does |
| --- | --- |
| Prepare risk data | Fills or reshapes fields before a submission or endorsement is quoted |
| Validate risk data | Returns errors on fields, shown inline like any other validation |
| Rate | Prices every selected coverage; chosen as the Extension engine on the Rating tab |
| Underwrite | Adds referrals and declines next to the decision tables' |
| Installment schedule | Splits the premium and sets due dates for a pay plan; billing bills exactly what was quoted |
| Cancellation charges | Keeps part of the return premium, never more than is left to return |
| Select documents, add document data | Adds or removes scheduled documents and supplies `extension.*` merge fields to templates and notices |
| Field options, prefill fields | Supplies a field's choices, or fills fields when another one changes, while the agent types |
| Record panel, record action | Shows information or a button on the submission or policy page |
| Enrichment transform | Reshapes provider data on the product's Data tab |
| Automation | Runs when a domain event happens, such as a bound term or a failed payment |

Failures follow the binding's setting: stop with an error, or carry on without the extension. Rating and underwriting always stop, because a guessed premium or outcome is worse than none.

## Writing one

Extensions live under **Configure → Extensions**. Each has its files, the points it implements (each point calls the export named after it, so `field_options` calls `fieldOptions()`), the hosts it may call, and tests. **Try it** runs the draft once on any input and shows the output, logs and every network exchange.

Network access is limited to the hosts the extension lists, over https, and checked again on every redirect. Credentials are secrets saved on the extension and added by PAS to requests for a host, so the code never sees them and run records never contain them.

## Tests and publishing

Every point needs a test, and every test must pass to publish. **Record from real hosts** calls the real services once and saves what they returned; after that, tests and sandbox tenants answer from those recordings. Publishing compiles the draft and freezes it as the next version. Product versions bind a specific version, so publishing a new one never changes a product that's already live.

## Automations

An automation runs an extension version when chosen events happen, optionally only when a condition holds. It may call the PAS services it declares, such as adding a note to a policy's timeline or sending an email. Each event runs it once; if it fails part-way, the retry continues without repeating what already happened.

## Every run is kept

Each run records its input, output, logs, network exchanges and timing. **Runs** shows every extension's runs, failures first, and each extension has its own list. Runs are kept for 90 days.

## Limits

Extensions run in a separate sandbox service, each in a fresh interpreter with memory, CPU and time limits, so one tenant's code can't slow quoting for anyone else. They have no clock or randomness of their own: time comes from PAS, which keeps sandbox time travel and tests repeatable.
