import { Money } from "@pas/kernel";
import type { DownloadRecord, MoneyValue } from "../../domain/record";
import type { CommissionStatementRecord } from "../../domain/statement";
import type { DownloadFormat, FileEnvelope } from "../../ports/format";

/*
 * NOT ACORD AL3. AL3 group codes, record layouts and code lists are in the ACORD AL3 data
 * dictionary, which needs an ACORD licence; none of it is reproduced here. This writes a
 * fixed-width file with the same shape (one group per line: 4-character group name, 3-digit
 * length, padded fields) under made-up X* group names, so the pipeline, batching and resends can
 * be exercised end to end. Replace it with a licensed mapping or IVANS translation before go-live.
 */

const pad = (value: string | number | null | undefined, width: number) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .slice(0, width)
    .padEnd(width, " ");

const cents = (value: MoneyValue | null) => {
  if (!value) return pad("", 12);

  const money = Money.of(value.amount, value.currency).round(2);
  const sign = money.isNegative() ? "-" : "+";

  return `${sign}${money.amount.abs().times(100).toFixed(0).padStart(11, "0")}`;
};

const date = (iso: string) => iso.slice(0, 10).replaceAll("-", "");

function group(name: string, ...fields: string[]): string {
  const body = fields.join("");

  return `${name}${String(name.length + 3 + body.length).padStart(3, "0")}${body}`;
}

const TRANSACTION: Record<DownloadRecord["transaction"]["kind"], string> = {
  new_business: "NBS",
  endorsement: "PCH",
  cancellation: "XLN",
  reinstatement: "REI",
  renewal: "RWL",
};

const header = (file: FileEnvelope, kind: string) =>
  group(
    "XHDR",
    pad("NON-CERTIFIED PLACEHOLDER, NOT ACORD AL3", 40),
    pad(file.sender.participantCode, 10),
    pad(file.recipient.accountCode, 5),
    pad(file.recipient.mailbox, 8),
    pad(date(file.createdAt.toString()), 8),
    pad(kind, 4),
    pad(file.test ? "T" : "P", 1),
    pad(file.fileId, 36),
  );

function transaction(r: DownloadRecord): string[] {
  return [
    group(
      "XTRN",
      pad(TRANSACTION[r.transaction.kind], 3),
      pad(date(r.transaction.effectiveDate), 8),
      pad(date(r.transaction.issuedAt), 8),
      pad(r.transaction.id, 36),
    ),
    group(
      "XPOL",
      pad(r.policy.number, 25),
      pad(r.policy.acordLob, 5),
      pad(date(r.policy.termEffectiveDate), 8),
      pad(date(r.policy.termExpirationDate), 8),
      pad(r.policy.subdivision?.slice(3), 2),
      pad(r.policy.billingMethod, 10),
      cents(r.policy.termPremium),
    ),
    group("XAGY", pad(r.agency.code, 10), pad(r.agency.name, 40), pad(r.producer.code, 10)),
    group(
      "XINS",
      pad(r.insured.surname ?? r.insured.name, 30),
      pad(r.insured.givenName, 20),
      pad(r.insured.mailingAddress?.line1, 30),
      pad(r.insured.mailingAddress?.city, 20),
      pad(r.insured.mailingAddress?.region, 2),
      pad(r.insured.mailingAddress?.postalCode, 10),
    ),
    ...r.locations.map((l) =>
      group(
        "XLOC",
        pad(l.ref, 4),
        pad(l.address?.line1, 30),
        pad(l.address?.city, 20),
        pad(l.address?.region, 2),
        pad(l.address?.postalCode, 10),
      ),
    ),
    ...r.coverages.map((c) =>
      group(
        "XCOV",
        pad(c.acordCode, 10),
        pad(c.locationRef, 4),
        cents(c.limit),
        cents(c.deductible),
        cents(c.termPremium),
        cents(c.transactionPremium),
      ),
    ),
    ...[...r.otherPremium, ...r.taxesFees].map((t) =>
      group("XTAX", pad(t.code, 20), pad(t.label, 30), cents(t.amount)),
    ),
    ...r.additionalInterests.map((i) =>
      group("XAIN", pad(i.kind, 12), pad(i.name, 40), pad(i.reference, 20)),
    ),
    group("XTOT", cents(r.totals.premium), cents(r.totals.taxesFees), cents(r.totals.total)),
  ];
}

const trailer = (lines: string[]) => group("XTRL", String(lines.length + 1).padStart(6, "0"));

function withTrailer(lines: string[]): string {
  return `${[...lines, trailer(lines)].join("\r\n")}\r\n`;
}

export const al3PlaceholderFormat: DownloadFormat = {
  id: "al3",
  label: "ACORD AL3 (placeholder)",
  extension: "al3",
  contentType: "text/plain",
  certified: false,
  policyFile: (envelope, records) =>
    withTrailer([header(envelope, "POL"), ...records.flatMap(transaction)]),
  commissionFile: (envelope, s: CommissionStatementRecord) =>
    withTrailer([
      header(envelope, "DBCS"),
      group("XCST", pad(s.agency.code, 10), pad(date(s.period.from), 8), pad(date(s.period.to), 8)),
      ...s.entries.map((e) =>
        group(
          "XCDT",
          pad(e.policyNumber, 25),
          pad(e.transactionType, 12),
          pad(date(e.effectiveDate), 8),
          cents(e.premium),
          pad(e.rate, 8),
          cents(e.commission),
        ),
      ),
      group("XCTT", cents(s.totals.gross), cents(s.totals.commission), cents(s.totals.net)),
    ]),
};
