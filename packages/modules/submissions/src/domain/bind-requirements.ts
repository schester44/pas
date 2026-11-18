import type { DecisionResult } from "@pas/decisions-engine";
import { type BindDetails, hasCompleteParties, isCompleteDeclination } from "./bind-details";

export type DiligentSearch = DecisionResult<"dea">;
export type Attestation = DecisionResult<"attestations">["attestations"][number];

export type BindRequirementKind =
  | "parties"
  | "diligent_search"
  | "attestation"
  | "signature"
  | "payment";

export interface BindRequirement {
  id: string;
  kind: BindRequirementKind;
  title: string;
  /** Blocking requirements must be met before the quote can be signed, paid and bound. */
  blocking: boolean;
  satisfied: boolean;
  statement?: string;
  declinationsRequired?: number;
  timing?: "pre_bind" | "post_bind";
}

export interface BindRequirementInput {
  diligentSearch: DiligentSearch | null;
  attestations: readonly Attestation[];
  details: BindDetails | null;
  signed: boolean;
  paid: boolean;
}

/**
 * The bind checklist (PLAN §7.2) from the release's decisions: a diligent search only when `dea`
 * requires one and no exemption applies, blocking only when it's due before binding, plus every
 * attestation the `attestations` decision returned.
 */
export function deriveBindRequirements(input: BindRequirementInput): BindRequirement[] {
  const { details } = input;

  const requirements: BindRequirement[] = [
    {
      id: "parties",
      kind: "parties",
      title: "Named insured, mailing address and producer",
      blocking: true,
      satisfied: hasCompleteParties(details),
    },
  ];

  const search = input.diligentSearch;

  if (search?.required && search.exemptions.length === 0) {
    const complete = (details?.declinations ?? []).filter(isCompleteDeclination).length;

    requirements.push({
      id: "diligent_search",
      kind: "diligent_search",
      title: "Diligent search affidavit",
      blocking: search.timing !== "post_bind",
      satisfied: complete >= search.declinationsRequired,
      declinationsRequired: search.declinationsRequired,
      timing: search.timing ?? "pre_bind",
    });
  }

  const accepted = new Set(details?.acknowledgements.map((ack) => ack.code));

  for (const attestation of input.attestations) {
    requirements.push({
      id: `attestation:${attestation.code}`,
      kind: "attestation",
      title: attestation.title,
      statement: attestation.statement,
      blocking: true,
      satisfied: accepted.has(attestation.code),
    });
  }

  requirements.push(
    {
      id: "signature",
      kind: "signature",
      title: "Signed application",
      blocking: true,
      satisfied: input.signed,
    },
    { id: "payment", kind: "payment", title: "Payment", blocking: true, satisfied: input.paid },
  );

  return requirements;
}

const STAGES: Record<"sign" | "pay" | "bind", readonly BindRequirementKind[]> = {
  sign: ["signature", "payment"],
  pay: ["payment"],
  bind: [],
};

/** Blocking requirements still open before `stage`, ignoring the ones that stage itself meets. */
export function outstandingFor(
  requirements: readonly BindRequirement[],
  stage: keyof typeof STAGES,
): BindRequirement[] {
  return requirements.filter(
    (requirement) =>
      requirement.blocking && !requirement.satisfied && !STAGES[stage].includes(requirement.kind),
  );
}
