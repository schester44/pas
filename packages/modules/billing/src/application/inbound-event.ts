import { Money } from "@pas/kernel";
import type { BillingEvent, BillingEventType } from "../domain/billing-event";

type MoneyJson = { amount: string; currency: string };

/** The canonical event as a billing system posts it, already validated at the edge. */
export interface InboundBillingEvent {
  id: string;
  type: BillingEventType;
  occurredAt: string;
  invoiceId?: string;
  statementId?: string;
  policyNumber?: string;
  amount?: MoneyJson;
  reference?: string;
  method?: { brand?: string; last4?: string };
  creditNoteId?: string;
  lines?: { code: string; label: string; amount: MoneyJson }[];
  reason?: string;
}

/** Maps an inbound event from a billing system install onto the one application path. */
export function billingEventFrom(installId: string, event: InboundBillingEvent): BillingEvent {
  return fromSource(`install:${installId}`, event);
}

/** The native billing system's events take the same path, under their own source and actor. */
export function nativeBillingEventFrom(
  event: InboundBillingEvent,
  actor: BillingEvent["actor"],
): BillingEvent {
  return { ...fromSource("native", event), provider: "Native billing", actor };
}

function fromSource(source: string, event: InboundBillingEvent): BillingEvent {
  return {
    eventId: event.id,
    source,
    type: event.type,
    occurredAt: Temporal.Instant.from(event.occurredAt),
    ...(event.invoiceId && { invoiceId: event.invoiceId }),
    ...(event.statementId && { statementId: event.statementId }),
    ...(event.policyNumber && { policyNumber: event.policyNumber }),
    ...(event.amount && { amount: Money.fromJSON(event.amount) }),
    ...(event.reference && { reference: event.reference }),
    ...(event.method && { method: event.method }),
    ...(event.creditNoteId && { creditNoteId: event.creditNoteId }),
    ...(event.lines && {
      lines: event.lines.map((line) => ({
        kind: "written_premium" as const,
        code: line.code,
        label: line.label,
        amount: Money.fromJSON(line.amount),
      })),
    }),
    ...(event.reason && { reason: event.reason }),
    provider: "billing_system",
    actor: { type: "api", name: "Billing system" },
  };
}
