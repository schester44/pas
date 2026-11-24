type MoneyJson = { amount: string; currency: string };

/** The carrier's own premium and the taxes and fees it charges, as it answered. */
export interface CarrierPrice {
  lines: { coverage: string; exposure?: string; amount: string }[];
  taxesFees: { code: string; label: string; amount: string }[];
}

export interface CarrierPayment {
  authorizationId: string;
  provider: string;
  amount: MoneyJson;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** A carrier-owned bind (PLAN §12): the quote waits in `pending_carrier` while the flows run. */
export interface CarrierBindState {
  status: "pending_carrier" | "issued" | "failed";
  phase: "bind" | "issue";
  flowRunId: string;
  reference: string | null;
  message: string | null;
  billingMethod: "direct" | "agency" | "mortgagee";
  payment: CarrierPayment | null;
  startedAt: string;
}

/**
 * The carrier's side of a quote on a release whose carrier rates or confirms. Plain JSON on the
 * evaluation, so every requote starts the carrier conversation over. When the carrier rates, the
 * quote has no price until it answers.
 */
export interface CarrierQuoteState {
  carrier: string;
  name: string;
  rating: "carrier" | "pas_confirmed";
  /** Whose premium, taxes and fees the quote carries once the carrier answers. */
  lineItems: "pas" | "carrier";
  status: "pending_carrier" | "quoted" | "referred" | "declined" | "failed";
  flowRunId: string | null;
  reference: string | null;
  messages: { code?: string; text: string }[];
  price: CarrierPrice | null;
  bind: CarrierBindState | null;
  updatedAt: string | null;
}

export function pendingCarrierQuote(input: {
  carrier: string;
  rating: CarrierQuoteState["rating"];
  lineItems: CarrierQuoteState["lineItems"];
}): CarrierQuoteState {
  return {
    carrier: input.carrier,
    name: input.carrier,
    rating: input.rating,
    lineItems: input.lineItems,
    status: "pending_carrier",
    flowRunId: null,
    reference: null,
    messages: [],
    price: null,
    bind: null,
    updatedAt: null,
  };
}

/** The carrier rates and hasn't answered, so the quote has no price yet. */
export const awaitingCarrierPrice = (carrier: CarrierQuoteState | undefined | null) =>
  carrier?.rating === "carrier" && carrier.status === "pending_carrier";

/** The carrier's price when the quote's figures come from it. */
export const carrierPriceFor = (carrier: CarrierQuoteState | undefined | null) =>
  carrier?.price && (carrier.rating === "carrier" || carrier.lineItems === "carrier")
    ? carrier.price
    : null;

export interface CarrierQuoteResult {
  status: "quoted" | "referred" | "declined" | "failed";
  reference: string | null;
  messages: { code?: string; text: string }[];
  price: CarrierPrice | null;
}
