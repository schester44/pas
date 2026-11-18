import { Button } from "@pas/ui/components/button";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { formatMoney } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import type { StepProps } from "./journey";
import { PremiumSummary } from "./premium";

export function PayStep({ quote, submission, go }: StepProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [card, setCard] = useState<CardDraft>(EMPTY_CARD);
  const [notice, setNotice] = useState<string | null>(null);
  const bind = useMutation(trpc.quotes.bind.mutationOptions());
  const total = formatMoney(quote.premium.total, { cents: true });
  const ready = cardReady(card);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);

    bind.mutate(
      {
        submissionId: submission.id,
        card: cardInput(card),
      },
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
          <div className="grid gap-4">
            <CardFields card={card} onChange={setCard} />
            <TestCardHint />
          </div>
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
          <Button type="submit" disabled={!ready || bind.isPending}>
            {bind.isPending ? <Spinner /> : <Lock />}
            Pay {total} and bind
          </Button>
        </div>
      </form>
      <PremiumSummary quote={quote} />
    </div>
  );
}
