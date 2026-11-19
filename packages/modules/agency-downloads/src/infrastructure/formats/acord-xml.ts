import { Money } from "@pas/kernel";
import type { AddressValue, DownloadRecord, MoneyValue, RecordCoverage } from "../../domain/record";
import type { CommissionStatementRecord } from "../../domain/statement";
import type { Attachment, DownloadFormat, FileEnvelope } from "../../ports/format";

/*
 * ACORD P&C XML, from the publicly documented message structure only (no licensed schema).
 * Verified against public ACORD samples: the ACORD > SignonRq > InsuranceSvcRq envelope, RqUID,
 * <LOB>Policy<Action>Rq message naming, Producer/InsuredOrPrincipal with GeneralPartyInfo
 * (NameInfo, Addr, Communications), PersPolicy/CommlPolicy with PolicyNumber, LOBCd, ContractTerm,
 * CurrentTermAmt, Location@id with LocationRef, Coverage with CoverageCd, Limit/Deductible as
 * FormatCurrencyAmt/Amt, and AdditionalInterest with NatureInterestCd.
 * Assumed until checked against the ACORD XML specification under licence and IVANS
 * certification: Rq vs Rs for downloads, the cancel message name and CancelInfo block, the tax and
 * fee block (TaxFeeInfo), ChangeStatus use on Mod messages, BillingMethodCd values,
 * FileAttachmentInfo for eDocs, the commission statement message, and every code list.
 */

type Node = { name: string; attrs?: Record<string, string>; children: (Node | string)[] };

const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function el(
  name: string,
  ...content: (Node | string | null | undefined | false | (Node | null)[])[]
): Node {
  const children = content.flat().filter((c): c is Node | string => !!c || c === "");

  return { name, children };
}

const withAttrs = (node: Node, attrs: Record<string, string>): Node => ({ ...node, attrs });

/** A leaf only when there's a value, so optional data leaves no empty elements. */
const leaf = (name: string, value: string | number | null | undefined) =>
  value === null || value === undefined || value === "" ? null : el(name, String(value));

function render(node: Node, depth = 0): string {
  const pad = "  ".repeat(depth);

  const attrs = Object.entries(node.attrs ?? {})
    .map(([k, v]) => ` ${k}="${escape(v)}"`)
    .join("");

  if (node.children.length === 1 && typeof node.children[0] === "string") {
    return `${pad}<${node.name}${attrs}>${escape(node.children[0])}</${node.name}>`;
  }

  if (node.children.length === 0) return `${pad}<${node.name}${attrs}/>`;

  const inner = node.children
    .map((c) => (typeof c === "string" ? `${pad}  ${escape(c)}` : render(c, depth + 1)))
    .join("\n");

  return `${pad}<${node.name}${attrs}>\n${inner}\n${pad}</${node.name}>`;
}

const amount = (value: MoneyValue) =>
  Money.of(value.amount, value.currency).round(2).amount.toFixed(2);

const amt = (name: string, value: MoneyValue | null) =>
  value ? el(name, el("Amt", amount(value))) : null;

const currencyAmt = (name: string, value: MoneyValue | null) =>
  value ? el(name, el("FormatCurrencyAmt", el("Amt", amount(value)))) : null;

const region = (subdivision: string | null) => subdivision?.replace(/^[A-Z]{2}-/, "") ?? null;

const addr = (address: AddressValue | null, type?: string) =>
  address &&
  el(
    "Addr",
    leaf("AddrTypeCd", type),
    leaf("Addr1", address.line1),
    leaf("Addr2", address.line2),
    leaf("City", address.city),
    leaf("StateProvCd", address.region),
    leaf("PostalCode", address.postalCode),
    leaf("CountryCd", address.country),
  );

const commercialName = (name: string) =>
  el("NameInfo", el("CommlName", el("CommercialName", name)));

/** ACORD message and line-of-business element names per ACORD LOB code. */
const LINES: Record<
  string,
  { message: string; policy: "PersPolicy" | "CommlPolicy"; line: string }
> = {
  HOME: { message: "HomePolicy", policy: "PersPolicy", line: "HomeLineBusiness" },
  DFIRE: { message: "DwellFirePolicy", policy: "PersPolicy", line: "DwellFireLineBusiness" },
  AUTOP: { message: "PersAutoPolicy", policy: "PersPolicy", line: "PersAutoLineBusiness" },
  FLOOD: { message: "HomePolicy", policy: "PersPolicy", line: "HomeLineBusiness" },
  INMRP: {
    message: "PersInlandMarinePolicy",
    policy: "PersPolicy",
    line: "PersInlandMarineLineBusiness",
  },
  BOP: { message: "BOPPolicy", policy: "CommlPolicy", line: "BOPLineBusiness" },
  CGL: {
    message: "GeneralLiabilityPolicy",
    policy: "CommlPolicy",
    line: "GeneralLiabilityLineBusiness",
  },
  PROPC: {
    message: "CommlPropertyPolicy",
    policy: "CommlPolicy",
    line: "CommlPropertyLineBusiness",
  },
};

const lineOf = (acordLob: string) =>
  LINES[acordLob] ?? {
    message: "PersPkgPolicy",
    policy: "PersPolicy" as const,
    line: "PersPkgLineBusiness",
  };

const ACTIONS: Record<DownloadRecord["transaction"]["kind"], "Add" | "Mod" | "Cancel"> = {
  new_business: "Add",
  renewal: "Add",
  endorsement: "Mod",
  reinstatement: "Mod",
  cancellation: "Cancel",
};

const BILLING: Record<string, string> = { direct: "CPB", agency: "AB", mortgagee: "MB" };

const INTERESTS: Record<string, string> = {
  mortgagee: "MORTG",
  additional_insured: "AI",
  loss_payee: "LOSSP",
  lienholder: "LIEN",
};

function coverage(c: RecordCoverage): Node {
  return el(
    "Coverage",
    el("CoverageCd", c.acordCode),
    el("CoverageDesc", c.name),
    currencyAmt("Limit", c.limit),
    currencyAmt("Deductible", c.deductible),
    amt("CurrentTermAmt", c.termPremium),
    amt("WrittenAmt", c.transactionPremium),
  );
}

function interest(record: DownloadRecord["additionalInterests"][number]): Node {
  return withAttrs(
    el(
      "AdditionalInterest",
      el("GeneralPartyInfo", commercialName(record.name), addr(record.address, "MailingAddress")),
      el(
        "AdditionalInterestInfo",
        el("NatureInterestCd", INTERESTS[record.kind] ?? "AI"),
        leaf("AccountNumberId", record.reference),
      ),
    ),
    { id: record.ref },
  );
}

function insured(record: DownloadRecord): Node {
  const { givenName, surname, name, email, mailingAddress } = record.insured;

  return el(
    "InsuredOrPrincipal",
    el(
      "GeneralPartyInfo",
      givenName && surname
        ? el("NameInfo", el("PersonName", el("Surname", surname), el("GivenName", givenName)))
        : commercialName(name),
      addr(mailingAddress, "MailingAddress"),
      email && el("Communications", el("EmailInfo", el("EmailAddr", email))),
    ),
    el("InsuredOrPrincipalInfo", el("InsuredOrPrincipalRoleCd", "Insured")),
  );
}

function lineBusiness(record: DownloadRecord, line: string): Node {
  const byLocation = (ref: string | null) => record.coverages.filter((c) => c.locationRef === ref);
  const [firstLocation] = record.locations;

  const dwellings = record.locations.map((location) => {
    const year = location.attributes.yearBuilt;
    const construction = location.attributes.construction;

    return withAttrs(
      el(
        "Dwell",
        (year !== undefined || construction !== undefined) &&
          el(
            "Construction",
            leaf("YearBuilt", year as string | number | undefined),
            leaf("ConstructionCd", construction as string | undefined),
          ),
        byLocation(location.ref).map(coverage),
        location === firstLocation && record.additionalInterests.map(interest),
      ),
      { LocationRef: location.ref },
    );
  });

  return el(
    line,
    el("LOBCd", record.policy.acordLob),
    dwellings,
    byLocation(null).map(coverage),
    !firstLocation && record.additionalInterests.map(interest),
  );
}

function policy(record: DownloadRecord, element: string, action: string): Node {
  const t = record.transaction;

  return el(
    element,
    el("PolicyNumber", record.policy.number),
    el("LOBCd", record.policy.acordLob),
    el(
      "ContractTerm",
      el("EffectiveDt", record.policy.termEffectiveDate),
      el("ExpirationDt", record.policy.termExpirationDate),
    ),
    leaf("BillingMethodCd", record.policy.billingMethod && BILLING[record.policy.billingMethod]),
    amt("CurrentTermAmt", record.policy.termPremium),
    leaf("ControllingStateProvCd", region(record.policy.subdivision)),
    action === "Mod" &&
      (t.changes.length > 0
        ? t.changes.map((c) =>
            el(
              "ChangeStatus",
              el("ActionCd", "M"),
              el("Description", `${c.label}: ${c.before} to ${c.after}`),
            ),
          )
        : [el("ChangeStatus", el("ActionCd", "M"), el("Description", t.reason ?? t.kind))]),
    action === "Cancel" &&
      el(
        "CancelInfo",
        el("CancelEffectiveDt", t.effectiveDate),
        leaf("CancelReasonDesc", t.reason),
        amt("ReturnPremiumAmt", record.totals.premium),
      ),
    record.otherPremium.map((p) =>
      el(
        "TaxFeeInfo",
        el("TaxFeeTypeCd", p.code),
        el("Description", p.label),
        amt("TaxFeeAmt", p.amount),
      ),
    ),
    record.taxesFees.map((tax) =>
      el(
        "TaxFeeInfo",
        el("TaxFeeTypeCd", tax.code),
        el("Description", tax.label),
        amt("TaxFeeAmt", tax.amount),
      ),
    ),
    amt("WrittenAmt", record.totals.premium),
    amt("TotalAmt", record.totals.total),
  );
}

function message(record: DownloadRecord, attachments: readonly Attachment[]): Node {
  const line = lineOf(record.policy.acordLob);
  const action = ACTIONS[record.transaction.kind];
  const t = record.transaction;

  return el(
    `${line.message}${action}Rq`,
    el("RqUID", t.id),
    el("TransactionRequestDt", t.issuedAt),
    el("TransactionEffectiveDt", t.effectiveDate),
    el("CurCd", record.totals.total.currency),
    el(
      "Producer",
      el("GeneralPartyInfo", commercialName(record.agency.name)),
      el(
        "ProducerInfo",
        leaf("ContractNumber", record.agency.code),
        leaf("ProducerSubCode", record.producer.code),
        leaf("ProducerRoleCd", "Agency"),
      ),
    ),
    insured(record),
    policy(record, line.policy, action),
    record.locations.map((l) => withAttrs(el("Location", addr(l.address)), { id: l.ref })),
    action !== "Cancel" && lineBusiness(record, line.line),
    attachments
      .filter((a) => a.transactionId === t.id)
      .map((a) =>
        el(
          "FileAttachmentInfo",
          el("AttachmentFilename", a.fileName),
          el("MIMEContentTypeCd", a.contentType),
          el("AttachmentData", Buffer.from(a.body).toString("base64")),
        ),
      ),
  );
}

function envelope(file: FileEnvelope, body: Node[]): string {
  const doc = el(
    "ACORD",
    el(
      "SignonRq",
      el("ClientDt", file.createdAt.toString()),
      el("CustLangPref", "en-US"),
      el(
        "ClientApp",
        el("Org", file.sender.participantCode || file.sender.name),
        el("Name", file.sender.name),
        el("Version", "1.0"),
      ),
    ),
    el(
      "InsuranceSvcRq",
      el("RqUID", file.fileId),
      leaf(
        "SPName",
        file.recipient.mailbox
          ? `${file.recipient.accountCode}${file.recipient.mailbox}`
          : file.recipient.accountCode,
      ),
      file.test && el("TestInd", "1"),
      body,
    ),
  );

  return `<?xml version="1.0" encoding="UTF-8"?>\n${render(doc)}\n`;
}

function statement(s: CommissionStatementRecord): Node {
  return el(
    "CommissionStatementRq",
    el(
      "Producer",
      el("GeneralPartyInfo", commercialName(s.agency.name)),
      el("ProducerInfo", leaf("ContractNumber", s.agency.code), leaf("ProducerRoleCd", "Agency")),
    ),
    el("StatementPeriod", el("StartDt", s.period.from), el("EndDt", s.period.to)),
    s.entries.map((e) =>
      el(
        "CommissionDetail",
        el("PolicyNumber", e.policyNumber),
        el("InsuredName", e.insuredName),
        el("TransactionTypeCd", e.transactionType),
        el("TransactionEffectiveDt", e.effectiveDate),
        amt("WrittenAmt", e.premium),
        el("CommissionRatePct", e.rate),
        amt("CommissionAmt", e.commission),
      ),
    ),
    amt("GrossAmt", s.totals.gross),
    amt("CommissionAmt", s.totals.commission),
    amt("NetAmt", s.totals.net),
  );
}

export const acordXmlFormat: DownloadFormat = {
  id: "acord_xml",
  label: "ACORD XML",
  extension: "xml",
  contentType: "application/xml",
  certified: false,
  policyFile: (file, records, attachments) =>
    envelope(
      file,
      records.map((r) => message(r, attachments)),
    ),
  commissionFile: (file, s) => envelope(file, [statement(s)]),
};
