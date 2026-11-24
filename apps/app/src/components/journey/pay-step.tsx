import type { AppOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import type * as React from "react";
import { useId, useState } from "react";
import { Checkbox } from "@pas/ui/components/checkbox";
import { Label } from "@pas/ui/components/label";
import {
  type CardDraft,
  CardFields,
  cardInput,
  cardReady,
  EMPTY_CARD,
  TestCardHint,
} from "@/components/card-fields";
import { StripeProvider, useStripeCard } from "@/components/stripe-card";
import { formatMoney } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { type BillingMethod, BillingMethodChoice } from "./billing-method";
import { ClientCompletionPanel, useCompletion } from "./client-completion";
import type { StepProps } from "./journey";
import { scheduleSummary, selectedOffer } from "./pay-plans";
import { PremiumSummary } from "./premium";

type Payment = { card: ReturnType<typeof cardInput> } | { paymentToken: string };
type BindResult = AppOutputs["quotes"]["bind"];

export function PayStep(props: StepProps) {
  const trpc = useTRPC();
  const checkout = useQuery(trpc.quotes.checkout.queryOptions());

  if (!checkout.data) {
    return (
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {checkout.error ? (
          <Notice tone="error" title="Couldn't load payment">
            {checkout.error.message}
          </Notice>
        ) : (
          <div className="h-64 animate-pulse rounded-xl border bg-card" />
        )}
        <PremiumSummary quote={props.quote} />
      </div>
    );
  }

  return checkout.data.kind === "stripe" ? (
    <StripeProvider publishableKey={checkout.data.publishableKey}>
      <StripePay {...props} testMode={checkout.data.testMode} />
    </StripeProvider>
  ) : (
    <CardFormPay {...props} />
  );
}

function CardFormPay(props: StepProps) {
  const [card, setCard] = useState<CardDraft>(EMPTY_CARD);

  return (
    <PayLayout
      {...props}
      ready={cardReady(card)}
      fields={
        <>
          <CardFields card={card} onChange={setCard} />
          <TestCardHint />
        </>
      }
      payment={async () => ({ card: cardInput(card) })}
    />
  );
}

function StripePay(props: StepProps & { testMode: boolean }) {
  const card = useStripeCard();

  return (
    <PayLayout
      {...props}
      ready={card.ready}
      fields={
        <>
          {card.fields}
          {props.testMode && <TestCardHint />}
        </>
      }
      payment={async () => {
        const result = await card.tokenize();

        if ("error" in result) throw new Error(result.error);

        return { paymentToken: result.token };
      }}
    />
  );
}

function PayLayout({
  quote,
  submission,
  go,
  fields,
  ready,
  payment,
}: StepProps & {
  fields: React.ReactNode;
  ready: boolean;
  payment: () => Promise<Payment>;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const id = useId();
  const bind = useMutation(trpc.quotes.bind.mutationOptions());
  const licensing = useQuery(trpc.quoteLicensing.queryOptions({ submissionId: submission.id }));

  const options = useQuery(
    trpc.quotes.billingOptions.queryOptions({ submissionId: submission.id }),
  );

  const completion = useCompletion(submission.id);
  const [billingMethod, setBillingMethod] = useState<BillingMethod>("direct");
  const billed = billingMethod !== "direct";
  const clientPays = !billed && completion?.rules.payment === "insured";
  const eitherPays = !billed && completion?.rules.payment === "either";
  const offer = selectedOffer(quote);
  const installments = offer !== null && offer.installments > 1;
  const [autopay, setAutopay] = useState(true);
  const total = formatMoney(offer?.dueToday ?? quote.premium.total, { cents: true });
  const busy = collecting || bind.isPending;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);

    if (billed) {
      bind.mutate({ submissionId: submission.id, billingMethod }, { onSuccess: onBound });

      return;
    }

    setCollecting(true);

    let method: Payment;

    try {
      method = await payment();
    } catch (error) {
      setNotice((error as Error).message);

      return;
    } finally {
      setCollecting(false);
    }

    bind.mutate(
      { submissionId: submission.id, ...method, autopay: installments && autopay },
      { onSuccess: onBound },
    );
  }

  function onBound(result: BindResult) {
    const key = trpc.quotes.get.queryKey({ submissionId: submission.id });

    if (result.status === "payment_declined") {
      setNotice(`${result.message} Try another card.`);

      return;
    }

    queryClient.setQueryData(key, result.quote);
    void queryClient.invalidateQueries({ queryKey: trpc.submissions.list.queryKey() });

    if (result.status === "rechecked" && result.quote.status === "quoted") go("review");
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form onSubmit={onSubmit} className="grid gap-6">
        {options.data && options.data.length > 1 && (
          <BillingMethodChoice
            options={options.data}
            value={billingMethod}
            onChange={setBillingMethod}
            quote={quote}
          />
        )}
        {clientPays && (
          <ClientCompletionPanel
            quote={quote}
            submissionId={submission.id}
            completion={completion}
            title="Waiting for the insured to pay"
          />
        )}
        {!billed && !clientPays && (
          <Panel
            title={offer ? offer.label : "Pay in full"}
            description={
              offer ? (
                <span className="tabular-nums">{scheduleSummary(offer)}</span>
              ) : (
                "Charged once the policy is bound."
              )
            }
          >
            <div className="grid gap-4">
              {fields}
              {installments && (
                <div className="flex items-start gap-3 rounded-lg border px-3 py-3">
                  <Checkbox
                    id={`${id}-autopay`}
                    checked={autopay}
                    onCheckedChange={(checked) => setAutopay(checked === true)}
                    className="mt-0.5"
                  />
                  <Label htmlFor={`${id}-autopay`} className="grid gap-1 font-normal">
                    <span className="font-medium">
                      Pay installments automatically with this card
                    </span>
                    <span className="text-xs text-muted-foreground">{quote.autopayConsent}</span>
                  </Label>
                </div>
              )}
            </div>
          </Panel>
        )}
        {licensing.data?.message && !bind.error && (
          <Notice
            tone={licensing.data.blocks ? "error" : "warning"}
            title="Producer isn't licensed for this risk"
          >
            {licensing.data.message}.{" "}
            {licensing.data.blocks
              ? "Binding is blocked until the license is on file."
              : "You can still bind; compliance will follow up."}
          </Notice>
        )}
        {(notice || bind.error) && (
          <Notice tone="error" title={notice ? "Payment declined" : "Couldn't bind"}>
            {notice ?? bind.error?.message}
          </Notice>
        )}
        {eitherPays && completion && (
          <ClientCompletionPanel
            quote={quote}
            submissionId={submission.id}
            completion={completion}
            title="Or let the insured pay"
          />
        )}
        <div className="flex justify-between gap-2">
          <Button type="button" variant="outline" onClick={() => go("review")}>
            Back
          </Button>
          {!clientPays && (
            <Button type="submit" disabled={(!billed && !ready) || busy}>
              {busy ? <Spinner /> : !billed && <Lock />}
              {billed
                ? `Bind on ${billingMethod === "agency" ? "agency" : "mortgagee"} bill`
                : `Pay ${total} and bind`}
            </Button>
          )}
        </div>
      </form>
      <PremiumSummary quote={quote} />
    </div>
  );
}
