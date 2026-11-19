import type { TenantContext, Transaction } from "@pas/kernel";
import type { Obligation } from "../domain/obligation";
import type { FilingOutcome, FilingResult } from "../ports/filing-channel";
import { type ComplianceDeps, recordOnPolicy } from "./deps";

/** Records a channel's answer on the obligation and the policy timeline; `pending` changes nothing. */
export async function applyResult(
  deps: Pick<ComplianceDeps, "timeline" | "clocks">,
  tx: Transaction,
  ctx: TenantContext,
  obligation: Obligation,
  filingId: string,
  result: FilingResult | FilingOutcome,
  channelName: string,
): Promise<boolean> {
  const clock = deps.clocks.forTenant(ctx.tenantId);
  const actor = { type: "channel" as const, name: channelName };

  if (result.status === "accepted") {
    obligation.accept(
      filingId,
      { filingNumber: result.filingNumber, stampNumber: result.stampNumber ?? null, actor },
      clock,
    );

    await recordOnPolicy(deps, tx, ctx, obligation, "filing_accepted", result.filingNumber);

    return true;
  }

  if (result.status === "rejected") {
    obligation.reject(filingId, { reasons: result.reasons, actor }, clock);
    await recordOnPolicy(deps, tx, ctx, obligation, "filing_rejected", result.reasons.join("; "));

    return true;
  }

  return false;
}
