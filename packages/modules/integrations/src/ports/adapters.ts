import type { DataProvider } from "@pas/enrichment";
import type { Instant, Money, TenantContext } from "@pas/kernel";

export type { DataProvider };

/** The published adapter contracts (PLAN §16): what a provider package implements per category. */

export type PaymentMethodInput =
  | {
      kind: "card";
      number: string;
      expMonth: number;
      expYear: number;
      cvc: string;
      name: string;
      postalCode?: string;
    }
  | { kind: "token"; token: string };

export interface PaymentMethodSummary {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export type Authorization =
  | { status: "authorized"; authorizationId: string; method: PaymentMethodSummary }
  | { status: "declined"; code: string; message: string; method: PaymentMethodSummary };

/** How the payer's browser collects a card for this provider. */
export type CheckoutSetup =
  | { kind: "card_form"; testMode: boolean }
  | { kind: "stripe"; publishableKey: string; testMode: boolean };

export interface CardPayments {
  readonly provider: string;
  readonly checkout: CheckoutSetup;
  authorize(
    ctx: TenantContext,
    input: { reference: string; idempotencyKey: string; amount: Money; method: PaymentMethodInput },
  ): Promise<Authorization>;
  capture(ctx: TenantContext, input: { authorizationId: string; amount: Money }): Promise<void>;
  void(ctx: TenantContext, input: { authorizationId: string }): Promise<void>;
  refund(
    ctx: TenantContext,
    input: { paymentRef: string; amount: Money; idempotencyKey: string },
  ): Promise<{ refundId: string }>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  tag: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<{ messageId: string | null } | void>;
}

export interface SignatureRequest {
  reference: string;
  title: string;
  document: Uint8Array;
  signer: { name: string; email?: string };
}

export interface SignatureEvidence {
  typedName: string;
  consent: string;
  signedAt: Instant;
  ipAddress: string;
  userAgent: string;
}

export interface ESignProvider {
  readonly provider: string;
  sign(
    ctx: TenantContext,
    request: SignatureRequest,
    evidence: SignatureEvidence,
  ): Promise<{ envelopeId: string; document: Uint8Array; sha256: string }>;
}

export interface PostalAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export type MailType = "first_class" | "certified" | "certified_return_receipt";

export interface LetterRequest {
  /** Our idempotency key and the business object the letter belongs to. */
  reference: string;
  description: string;
  to: PostalAddress;
  from: PostalAddress;
  mailType: MailType;
  document: Uint8Array;
}

export interface LetterReceipt {
  providerRef: string;
  status: string;
  trackingNumber: string | null;
  expectedDeliveryDate: string | null;
}

export interface PrintMail {
  sendLetter(letter: LetterRequest): Promise<LetterReceipt>;
}

export interface CategoryAdapters {
  payments: CardPayments;
  esign: ESignProvider;
  email: EmailSender;
  print_mail: PrintMail;
  data: DataProvider;
}

export type AdapterCategory = keyof CategoryAdapters;
