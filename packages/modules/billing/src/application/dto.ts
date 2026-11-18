import type { Invoice, PaymentProps } from "../domain/invoice";

type MoneyDto = { amount: string; currency: string };

export interface InvoiceDto {
  id: string;
  number: string;
  kind: "invoice" | "credit_note";
  policyId: string;
  policyNumber: string;
  transactionId: string;
  status: string;
  issuedOn: string;
  dueOn: string;
  total: MoneyDto;
  amountPaid: MoneyDto;
  balance: MoneyDto;
  lines: {
    kind: string;
    code: string;
    label: string;
    coverage?: string;
    exposure?: string;
    amount: MoneyDto;
  }[];
}

export interface PaymentDto {
  id: string;
  invoiceId: string;
  provider: string;
  reference: string;
  method: Record<string, unknown>;
  amount: MoneyDto;
  receivedAt: string;
}

export function toInvoiceDto(invoice: Invoice): InvoiceDto {
  const i = invoice.toSnapshot();

  return {
    id: i.id,
    number: i.number,
    kind: i.kind,
    policyId: i.policyId,
    policyNumber: i.policyNumber,
    transactionId: i.transactionId,
    status: i.status,
    issuedOn: i.issuedOn.toString(),
    dueOn: i.dueOn.toString(),
    total: i.total.toJSON(),
    amountPaid: i.amountPaid.toJSON(),
    balance: invoice.balance.toJSON(),
    lines: i.lines.map((line) => ({
      kind: line.kind,
      code: line.code,
      label: line.label,
      ...(line.coverage && { coverage: line.coverage }),
      ...(line.exposure && { exposure: line.exposure }),
      amount: line.amount.toJSON(),
    })),
  };
}

export function toPaymentDto(payment: PaymentProps): PaymentDto {
  return {
    id: payment.id,
    invoiceId: payment.invoiceId,
    provider: payment.provider,
    reference: payment.providerRef,
    method: payment.method,
    amount: payment.amount.toJSON(),
    receivedAt: payment.receivedAt.toString(),
  };
}
