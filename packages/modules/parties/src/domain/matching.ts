import type { ContactKeys } from "./contact";

export interface MatchCandidate extends ContactKeys {
  id: string;
}

export type MatchReason = "email" | "name_and_phone" | "name_and_address";

export interface ClientMatch {
  accountId: string;
  reason: MatchReason;
}

const overlaps = (a: readonly string[], b: readonly string[]) => a.some((key) => b.includes(key));

/**
 * The existing client account an insured belongs to, strongest evidence first. A name alone
 * never matches, and a shared address doesn't override two different email addresses.
 * Candidates come oldest first, so the earliest account wins a tie.
 */
export function matchClientAccount(
  contact: ContactKeys,
  candidates: readonly MatchCandidate[],
): ClientMatch | null {
  const sameKind = candidates.filter((c) => c.kind === contact.kind);
  const named = sameKind.filter((c) => c.nameKey.length > 0 && c.nameKey === contact.nameKey);

  const byEmail = sameKind.find((c) => overlaps(c.emailKeys, contact.emailKeys));

  if (byEmail) return { accountId: byEmail.id, reason: "email" };

  const byPhone = named.find((c) => overlaps(c.phoneKeys, contact.phoneKeys));

  if (byPhone) return { accountId: byPhone.id, reason: "name_and_phone" };

  const byAddress = named.find(
    (c) =>
      contact.addressKey !== null &&
      c.addressKey === contact.addressKey &&
      (c.emailKeys.length === 0 || contact.emailKeys.length === 0),
  );

  if (byAddress) return { accountId: byAddress.id, reason: "name_and_address" };

  return null;
}
