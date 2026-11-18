import type { FormDefinition, RiskSchema } from "@pas/forms-core";
import type { TenantContext } from "@pas/kernel";
import { endorsementForm } from "../domain/endorsable";
import type { PolicyScope } from "../domain/scope";
import { coveragesOf } from "../domain/term-state";
import type { CoverageChoice, CoverageOffer } from "../ports/term-rater";
import { type TransactionDto, toTransactionDto } from "./dto";
import { type ChangeDeps, choiceOf, loadPolicy, today } from "./pricing";

export interface EndorsementSetupDto {
  schema: RiskSchema;
  form: FormDefinition | null;
  risk: Record<string, unknown>;
  offers: CoverageOffer[];
  selection: CoverageChoice[];
  parties: { mailingAddress: unknown; additionalInterests: unknown[] };
  termStart: string;
  termEnd: string;
  earliestEffective: string;
  open: TransactionDto | null;
}

/** What the change editor needs: the endorsable form, the coverage offers and the current state. */
export function makeGetEndorsementSetup(
  deps: Pick<ChangeDeps, "uow" | "policies" | "config" | "rater" | "clocks">,
) {
  return async function getEndorsementSetup(
    ctx: TenantContext,
    scope: PolicyScope,
    input: { policyId: string },
  ): Promise<EndorsementSetupDto> {
    const policy = await loadPolicy(deps, ctx, scope, input.policyId);
    const term = policy.currentTerm;
    const snapshot = policy.latestVersion(term.id).snapshot;
    const release = await deps.config.release(ctx, term.productReleaseId);
    const risk = (snapshot.risk ?? {}) as Record<string, unknown>;
    const selection = coveragesOf(snapshot).map(choiceOf);
    const lastChange = policy.lastIssued(term.id)?.effectiveDate ?? term.effectiveDate;
    const now = today(deps.clocks.forTenant(ctx.tenantId));

    const earliest = [now, lastChange, term.effectiveDate].reduce((a, b) =>
      Temporal.PlainDate.compare(a, b) >= 0 ? a : b,
    );

    const rating = await deps.rater.rate(ctx, {
      productReleaseId: term.productReleaseId,
      jurisdiction: term.jurisdiction,
      termStart: term.effectiveDate,
      termEnd: term.expirationDate,
      transaction: { type: "ENDORSEMENT", effective: earliest },
      risk,
      coverages: selection,
    });

    const parties = (snapshot.parties ?? {}) as Record<string, unknown>;
    const open = policy.openTransaction(term.id);

    return {
      schema: release.riskSchema,
      form: endorsementForm(release.riskSchema, release.forms),
      risk,
      offers: rating.offers,
      selection,
      parties: {
        mailingAddress: parties.mailingAddress ?? risk.mailingAddress ?? null,
        additionalInterests: (parties.additionalInterests ?? []) as unknown[],
      },
      termStart: term.effectiveDate.toString(),
      termEnd: term.expirationDate.toString(),
      earliestEffective: earliest.toString(),
      open: open && toTransactionDto(open),
    };
  };
}

export type GetEndorsementSetup = ReturnType<typeof makeGetEndorsementSetup>;
