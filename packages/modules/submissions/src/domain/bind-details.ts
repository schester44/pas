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
  /** The NRRA home state (PLAN §17.2.2), e.g. `US-IL`; defaults from the mailing address. */
  homeState?: string;
  acknowledgements: Acknowledgement[];
}

const filled = (value: string | undefined) => (value ?? "").trim().length > 0;

const SUBDIVISION = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;

/** The declared home state, else the mailing address's state; null when neither says. */
export function homeStateOf(
  details: Pick<BindDetails, "homeState" | "mailingAddress">,
  country: string,
): string | null {
  if (details.homeState && SUBDIVISION.test(details.homeState)) return details.homeState;

  const region = details.mailingAddress?.region?.trim().toUpperCase();
  const code = region && `${(details.mailingAddress?.country ?? country).toUpperCase()}-${region}`;

  return code && SUBDIVISION.test(code) ? code : null;
}

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
