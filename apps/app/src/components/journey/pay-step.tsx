import { Button } from "@pas/ui/components/button";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
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
import type { StepProps } from "./journey";
import { PremiumSummary } from "./premium";

type Payment = { card: ReturnType<typeof cardInput> } | { paymentToken: string };

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
  const bind = useMutation(trpc.quotes.bind.mutationOptions());
  const total = formatMoney(quote.premium.total, { cents: true });
  const busy = collecting || bind.isPending;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);
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
      { submissionId: submission.id, ...method },
      {
        onSuccess: (result) => {
          const key = trpc.quotes.get.queryKey({ submissionId: submission.id });

          if (result.status === "payment_declined") {
            setNotice(`${result.message} Try another card.`);

            return;
          }

          queryClient.setQueryData(key, result.quote);
          void queryClient.invalidateQueries({ queryKey: trpc.submissions.list.queryKey() });

          if (result.status === "rechecked" && result.quote.status === "quoted") go("review");
        },
      },
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form onSubmit={onSubmit} className="grid gap-6">
        <Panel title="Pay in full" description="Charged once the policy is bound.">
          <div className="grid gap-4">{fields}</div>
        </Panel>
        {(notice || bind.error) && (
          <Notice tone="error" title={notice ? "Payment declined" : "Couldn't bind"}>
            {notice ?? bind.error?.message}
          </Notice>
        )}
        <div className="flex justify-between gap-2">
          <Button type="button" variant="outline" onClick={() => go("review")}>
            Back
          </Button>
          <Button type="submit" disabled={!ready || busy}>
            {busy ? <Spinner /> : <Lock />}
            Pay {total} and bind
          </Button>
        </div>
      </form>
      <PremiumSummary quote={quote} />
    </div>
  );
}
