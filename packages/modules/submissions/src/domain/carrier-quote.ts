type MoneyJson = { amount: string; currency: string };

export interface CarrierFigureDiff {
  currency: string;
  changes: {
    key: string;
    label: string;
    pas: string | null;
    carrier: string | null;
    difference: string;
  }[];
  pasTotal: string;
  carrierTotal: string;
  difference: string;
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
 * evaluation, so every requote starts the carrier conversation over.
 */
export interface CarrierQuoteState {
  carrier: string;
  name: string;
  rating: "carrier" | "pas_confirmed";
  figuresWin: boolean;
  status: "pending_carrier" | "quoted" | "referred" | "declined" | "failed";
  flowRunId: string | null;
  reference: string | null;
  messages: { code?: string; text: string }[];
  pas: { premium: MoneyJson; total: MoneyJson } | null;
  diff: CarrierFigureDiff | null;
  bind: CarrierBindState | null;
  updatedAt: string | null;
}

export function pendingCarrierQuote(input: {
  carrier: string;
  rating: CarrierQuoteState["rating"];
  figuresWin: boolean;
}): CarrierQuoteState {
  return {
    carrier: input.carrier,
    name: input.carrier,
    rating: input.rating,
    figuresWin: input.figuresWin,
    status: "pending_carrier",
    flowRunId: null,
    reference: null,
    messages: [],
    pas: null,
    diff: null,
    bind: null,
    updatedAt: null,
  };
}

export interface CarrierQuoteResult {
  status: "quoted" | "referred" | "declined" | "failed";
  reference: string | null;
  messages: { code?: string; text: string }[];
  diff: CarrierFigureDiff | null;
}
