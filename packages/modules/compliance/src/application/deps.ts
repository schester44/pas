import {
  type ClockProvider,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
  notFound,
  type Transaction,
} from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import type { Obligation, ObligationActor, ObligationId } from "../domain/obligation";
import type { FilingChannels } from "../ports/filing-channel";
import type { LicenseeRepository } from "../ports/licensee-repository";
import type { ObligationRepository } from "../ports/obligation-repository";
import type { PolicySource, PolicyTimeline } from "../ports/policy-source";

export interface ComplianceDeps {
  uow: UnitOfWork;
  outbox: Outbox;
  obligations: ObligationRepository;
  licensees: LicenseeRepository;
  policies: PolicySource;
  timeline: PolicyTimeline;
  channels: FilingChannels;
  storage: ObjectStorage;
  clocks: ClockProvider;
}

export async function loadObligation(
  deps: Pick<ComplianceDeps, "obligations">,
  tx: Transaction,
  ctx: TenantContext,
  id: string,
): Promise<Obligation> {
  const obligation = await deps.obligations.findById(tx, ctx, id as ObligationId);

  if (!obligation) throw notFound("Obligation", id);

  return obligation;
}

export async function persist(
  deps: Pick<ComplianceDeps, "obligations" | "outbox">,
  tx: Transaction,
  obligation: Obligation,
): Promise<void> {
  await deps.obligations.save(tx, obligation);
  await deps.outbox.add(tx, obligation.pullEvents());
}

export const userActor = (ctx: TenantContext, name: string): ObligationActor =>
  ctx.actor.type === "user"
    ? { type: "user", id: ctx.actor.userId, name }
    : { type: "system", name };

const KIND_LABEL: Record<string, string> = {
  filing_submitted: "submitted",
  filing_accepted: "accepted",
  filing_rejected: "rejected",
  obligation_overdue: "overdue",
};

/** Mirrors filing outcomes onto the policy's timeline. */
export async function recordOnPolicy(
  deps: Pick<ComplianceDeps, "timeline">,
  tx: Transaction,
  ctx: TenantContext,
  obligation: Obligation,
  type: "filing_submitted" | "filing_accepted" | "filing_rejected" | "obligation_overdue",
  detail?: string,
): Promise<void> {
  const s = obligation.toSnapshot();

  if (!s.subject.policyId) return;

  await deps.timeline.record(tx, ctx, {
    policyId: s.subject.policyId,
    ...(s.subject.transactionId && { transactionId: s.subject.transactionId }),
    type,
    summary: `${s.title} ${KIND_LABEL[type]}${detail ? `: ${detail}` : ""}`,
    data: { obligationId: s.id, kind: s.kind },
  });
}
