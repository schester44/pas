import type { AddressValue } from "@pas/forms-core";

export const INTEREST_KINDS = ["mortgagee", "additional_insured", "loss_payee"] as const;

export type InterestKind = (typeof INTEREST_KINDS)[number];

export interface AdditionalInterest {
  kind: InterestKind;
  name: string;
  address: AddressValue | null;
  reference?: string;
}

export interface AdmittedDeclination {
  carrier: string;
  declinedOn: string;
  reason: string;
}

export interface Acknowledgement {
  code: string;
  acceptedAt: string;
}

/** What the legal and compliance step captures before signing (PLAN §7.2.1 step 3). */
export interface BindDetails {
  namedInsureds: string[];
  mailingAddress: AddressValue | null;
  additionalInterests: AdditionalInterest[];
  producer: { name: string; agency?: string; licenseNumber?: string };
  declinations: AdmittedDeclination[];
  acknowledgements: Acknowledgement[];
}

const filled = (value: string | undefined) => (value ?? "").trim().length > 0;

export function isCompleteAddress(address: AddressValue | null): boolean {
  return (
    address !== null &&
    filled(address.line1) &&
    filled(address.city) &&
    filled(address.region) &&
    filled(address.postalCode)
  );
}

export function isCompleteDeclination(declination: AdmittedDeclination): boolean {
  return (
    filled(declination.carrier) &&
    /^\d{4}-\d{2}-\d{2}$/.test(declination.declinedOn) &&
    filled(declination.reason)
  );
}

export function hasCompleteParties(details: BindDetails | null): boolean {
  return (
    details !== null &&
    details.namedInsureds.some(filled) &&
    isCompleteAddress(details.mailingAddress) &&
    filled(details.producer.name) &&
    details.additionalInterests.every((interest) => filled(interest.name))
  );
}
