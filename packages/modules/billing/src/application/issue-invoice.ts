import {
  type Clock,
  Money,
  parsePlainDate,
  type TenantContext,
  type Transaction,
} from "@pas/kernel";
import { Invoice } from "../domain/invoice";
import { type ChargeKind, invoiceFrom } from "../domain/invoice-lines";
import { formatInvoiceNumber } from "../domain/invoice-number";
import type { InvoiceRepository } from "../ports/invoice-repository";
import { type InvoiceDto, toInvoiceDto } from "./dto";

type MoneyJson = { amount: string; currency: string };

export interface IssueInvoiceInput {
  policyId: string;
  policyNumber: string;
  transactionId: string;
  currency: string;
  charges: {
    kind: ChargeKind;
    code: string;
    label: string;
    coverage?: string;
    exposure?: string;
    amount: MoneyJson;
  }[];
  issuedOn: string;
  dueOn: string;
}

/**
 * Bills one financial policy transaction. Runs inside the issuing context's transaction, so a
 * transaction is never issued without its invoice; idempotent per transaction.
 */
export function makeIssueInvoice(deps: { invoices: InvoiceRepository; clock: Clock }) {
  return async function issueInvoice(
    tx: Transaction,
    ctx: TenantContext,
    input: IssueInvoiceInput,
  ): Promise<InvoiceDto> {
    const existing = await deps.invoices.findByTransaction(tx, ctx, input.transactionId);

    if (existing) return toInvoiceDto(existing);

    const draft = invoiceFrom(
      input.charges.map((c) => ({ ...c, amount: Money.of(c.amount.amount, c.amount.currency) })),
      input.currency,
      { places: 2, mode: "half_up" },
    );

    const invoice = Invoice.issue(
      {
        tenantId: ctx.tenantId,
        number: formatInvoiceNumber(await deps.invoices.nextSequence(tx, ctx)),
        policyId: input.policyId,
        policyNumber: input.policyNumber,
        transactionId: input.transactionId,
        issuedOn: parsePlainDate(input.issuedOn),
        dueOn: parsePlainDate(input.dueOn),
        draft,
      },
      deps.clock,
    );

    await deps.invoices.save(tx, invoice);

    return toInvoiceDto(invoice);
  };
}

export type IssueInvoice = ReturnType<typeof makeIssueInvoice>;
