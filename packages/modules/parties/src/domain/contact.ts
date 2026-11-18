export type ClientKind = "person" | "business";

export interface PostalAddress {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

/** What a producer captured about an insured: the input to matching and account creation. */
export interface InsuredContact {
  kind: ClientKind;
  name: string;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  email?: string;
  phone?: string;
  mailingAddress?: PostalAddress | null;
}

export interface ContactKeys {
  kind: ClientKind;
  nameKey: string;
  emailKeys: readonly string[];
  phoneKeys: readonly string[];
  addressKey: string | null;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const GMAIL = new Set(["gmail.com", "googlemail.com"]);

const BUSINESS_SUFFIXES = new Set(["inc", "llc", "ltd", "co", "corp", "corporation", "company"]);

const STREET_WORDS: Record<string, string> = {
  street: "st",
  avenue: "ave",
  road: "rd",
  drive: "dr",
  boulevard: "blvd",
  lane: "ln",
  court: "ct",
  place: "pl",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  apartment: "apt",
  suite: "ste",
};

const fold = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Lowercased; Gmail ignores dots and +tags, so those collapse to one mailbox. */
export function emailKey(email: string): string | null {
  const value = email.trim().toLowerCase();

  if (!EMAIL.test(value)) return null;

  const at = value.lastIndexOf("@");
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);

  if (!GMAIL.has(domain)) return value;

  return `${local.split("+")[0]!.replaceAll(".", "")}@gmail.com`;
}

export function phoneKey(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  return national.length >= 7 ? national : null;
}

/** Order-insensitive so "Avery, Jordan" and "Jordan Avery" agree. */
export function nameKey(name: string, kind: ClientKind): string {
  const words = fold(name);
  const kept = kind === "business" ? words.filter((w) => !BUSINESS_SUFFIXES.has(w)) : words;

  return kept.toSorted().join(" ");
}

export function postalKey(postalCode: string, country: string): string {
  const compact = postalCode.replace(/\s+/g, "").toUpperCase();

  return country.toUpperCase() === "US" ? compact.replace(/\D/g, "").slice(0, 5) : compact;
}

export function addressKey(address: PostalAddress | null | undefined): string | null {
  if (!address?.line1.trim() || !address.postalCode.trim()) return null;

  const street = fold(address.line1)
    .map((word) => STREET_WORDS[word] ?? word)
    .join(" ");

  return `${street}|${postalKey(address.postalCode, address.country)}`;
}

export function contactKeys(contact: InsuredContact): ContactKeys {
  const email = contact.email ? emailKey(contact.email) : null;
  const phone = contact.phone ? phoneKey(contact.phone) : null;

  return {
    kind: contact.kind,
    nameKey: nameKey(contact.name, contact.kind),
    emailKeys: email ? [email] : [],
    phoneKeys: phone ? [phone] : [],
    addressKey: addressKey(contact.mailingAddress),
  };
}
