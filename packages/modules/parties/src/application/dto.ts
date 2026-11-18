import type { ClientAccount } from "../domain/client-account";

export interface ClientAccountDto {
  id: string;
  kind: "person" | "business";
  displayName: string;
  firstName: string | null;
  emails: { address: string; verified: boolean }[];
  phones: string[];
  mailingAddress: {
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  } | null;
  status: "active" | "merged";
  invitedAt: string | null;
  createdAt: string;
}

export function toClientAccountDto(account: ClientAccount): ClientAccountDto {
  const a = account.toSnapshot();

  return {
    id: a.id,
    kind: a.kind,
    displayName: a.displayName,
    firstName: a.firstName,
    emails: a.emails.map((e) => ({ address: e.address, verified: e.verifiedAt !== null })),
    phones: a.phones.map((p) => p.number),
    mailingAddress: a.mailingAddress,
    status: a.status,
    invitedAt: a.invitedAt?.toString() ?? null,
    createdAt: a.createdAt.toString(),
  };
}
