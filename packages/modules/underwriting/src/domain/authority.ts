import { type Jurisdiction, jurisdictionCode, Money } from "@pas/kernel";

/**
 * What an underwriter may approve (PLAN §11): tenant data, not a role. Profiles are held by
 * members directly or through their role; a higher `level` outranks a lower one.
 */
export interface AuthorityProfile {
  key: string;
  name: string;
  level: number;
  /** Written premium ceiling; null is no limit. */
  maxPremium: string | null;
  /** Total insured value ceiling; null is no limit. */
  maxInsuredValue: string | null;
  /** Product ids this profile may approve; empty is every product. */
  products: string[];
  /** ISO 3166-2 codes; empty is every jurisdiction. */
  jurisdictions: string[];
  roles: string[];
  userIds: string[];
}

export interface Approver {
  userId: string;
  roles: readonly string[];
}

export interface ApprovalRequest {
  productId: string;
  jurisdiction: Jurisdiction;
  writtenPremium: Money;
  insuredValue: Money;
  /** The reasons' required authority keys (e.g. `senior_underwriter`). */
  authorities: readonly string[];
}

export type AuthorityCheck =
  | { ok: true; profile: AuthorityProfile }
  | { ok: false; profile: AuthorityProfile | null; problems: string[]; escalateTo: number };

const holds = (profile: AuthorityProfile, approver: Approver) =>
  profile.userIds.includes(approver.userId) ||
  profile.roles.some((role) => approver.roles.includes(role));

/** The approver's strongest profile; a profile named for the user wins over one through a role. */
export function profileOf(
  profiles: readonly AuthorityProfile[],
  approver: Approver,
): AuthorityProfile | null {
  const held = profiles.filter((p) => holds(p, approver));
  const direct = held.filter((p) => p.userIds.includes(approver.userId));

  return (direct.length > 0 ? direct : held).toSorted((a, b) => b.level - a.level)[0] ?? null;
}

/** The level the referral's reasons ask for; an authority no profile defines needs the top level. */
export function requiredLevel(
  profiles: readonly AuthorityProfile[],
  authorities: readonly string[],
): number {
  const top = Math.max(0, ...profiles.map((p) => p.level));

  return Math.max(
    0,
    ...authorities.map((key) => profiles.find((p) => p.key === key)?.level ?? top),
  );
}

const over = (limit: string | null, value: Money) =>
  limit !== null && Money.of(limit, value.currency).minus(value).isNegative();

function problemsFor(profile: AuthorityProfile, request: ApprovalRequest, needed: number) {
  const code = jurisdictionCode(request.jurisdiction);
  const problems: string[] = [];

  if (profile.level < needed)
    problems.push(`${profile.name} authority is below what the reasons need`);

  if (over(profile.maxPremium, request.writtenPremium))
    problems.push(
      `Premium is over the ${profile.name.toLowerCase()} limit of ${profile.maxPremium}`,
    );

  if (over(profile.maxInsuredValue, request.insuredValue))
    problems.push(
      `Insured value is over the ${profile.name.toLowerCase()} limit of ${profile.maxInsuredValue}`,
    );

  if (profile.products.length > 0 && !profile.products.includes(request.productId))
    problems.push(`${profile.name} authority doesn't cover this product`);

  if (profile.jurisdictions.length > 0 && !profile.jurisdictions.includes(code))
    problems.push(`${profile.name} authority doesn't cover ${code}`);

  return problems;
}

/**
 * Within authority approves; beyond it escalates to the lowest level that could approve it, or
 * the top level when no profile could.
 */
export function checkAuthority(
  profiles: readonly AuthorityProfile[],
  approver: Approver,
  request: ApprovalRequest,
): AuthorityCheck {
  const profile = profileOf(profiles, approver);
  const needed = requiredLevel(profiles, request.authorities);
  const problems = profile ? problemsFor(profile, request, needed) : ["No underwriting authority"];

  if (profile && problems.length === 0) return { ok: true, profile };

  const capable = profiles
    .filter((p) => p.level > (profile?.level ?? 0) && problemsFor(p, request, needed).length === 0)
    .toSorted((a, b) => a.level - b.level)[0];

  const top = Math.max(needed, ...profiles.map((p) => p.level));

  return { ok: false, profile, problems, escalateTo: capable?.level ?? top };
}
