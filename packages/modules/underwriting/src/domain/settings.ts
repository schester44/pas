import type { AuthorityProfile } from "./authority";

/** A reason an underwriter can decline for, with the wording the adverse-action notice uses. */
export interface DeclineReason {
  code: string;
  label: string;
  adverseActionNotice: string;
}

/** Tenant underwriting configuration (PLAN §11). Compliance wording lives here, not in code. */
export interface UnderwritingSettings {
  authorityProfiles: AuthorityProfile[];
  declineReasons: DeclineReason[];
  /** What an overdue post-bind subjectivity asks for when its decision doesn't say. */
  overdueConsequence: string | null;
}

export const EMPTY_SETTINGS: UnderwritingSettings = {
  authorityProfiles: [],
  declineReasons: [],
  overdueConsequence: null,
};
