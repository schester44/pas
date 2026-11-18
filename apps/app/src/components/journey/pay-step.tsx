import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import type { StepProps } from "./journey";
import { PremiumSummary } from "./premium";

const digits = (value: string) => value.replace(/\D/g, "");

const groupCard = (value: string) =>
  digits(value)
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, "$1 ");

function formatExpiry(value: string) {
  const d = digits(value).slice(0, 4);

  return d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d;
}

export function PayStep({ quote, submission, go }: StepProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [card, setCard] = useState({ number: "", expiry: "", cvc: "", name: "", postalCode: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const bind = useMutation(trpc.quotes.bind.mutationOptions());
  const total = formatMoney(quote.premium.total, { cents: true });
  const [month, year] = [digits(card.expiry).slice(0, 2), digits(card.expiry).slice(2, 4)];

  const ready =
    digits(card.number).length >= 13 &&
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    year.length === 2 &&
    /^\d{3,4}$/.test(card.cvc) &&
    card.name.trim().length > 0;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setNotice(null);

    bind.mutate(
      {
        submissionId: submission.id,
        card: {
          number: digits(card.number),
          expMonth: Number(month),
          expYear: 2000 + Number(year),
          cvc: card.cvc,
          name: card.name.trim(),
          ...(card.postalCode.trim() && { postalCode: card.postalCode.trim() }),
        },
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

  const set = (patch: Partial<typeof card>) => setCard((c) => ({ ...c, ...patch }));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form onSubmit={onSubmit} className="grid gap-6">
        <Panel title="Pay in full" description="Charged once the policy is bound.">
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="grid gap-2 sm:col-span-6">
              <Label htmlFor="card-number">Card number</Label>
              <Input
                id="card-number"
                value={card.number}
                inputMode="numeric"
                autoComplete="cc-number"
                placeholder="1234 1234 1234 1234"
                className="tabular-nums"
                onChange={(e) => set({ number: groupCard(e.target.value) })}
              />
            </div>
            <div className="grid gap-2 sm:col-span-3">
              <Label htmlFor="card-expiry">Expiry</Label>
              <Input
                id="card-expiry"
                value={card.expiry}
                inputMode="numeric"
                autoComplete="cc-exp"
                placeholder="MM / YY"
                className="tabular-nums"
                onChange={(e) => set({ expiry: formatExpiry(e.target.value) })}
              />
            </div>
            <div className="grid gap-2 sm:col-span-3">
              <Label htmlFor="card-cvc">Security code</Label>
              <Input
                id="card-cvc"
                value={card.cvc}
                inputMode="numeric"
                autoComplete="cc-csc"
                placeholder="CVC"
                className="tabular-nums"
                onChange={(e) => set({ cvc: digits(e.target.value).slice(0, 4) })}
              />
            </div>
            <div className="grid gap-2 sm:col-span-4">
              <Label htmlFor="card-name">Name on card</Label>
              <Input
                id="card-name"
                value={card.name}
                autoComplete="cc-name"
                onChange={(e) => set({ name: e.target.value })}
              />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="card-zip">
                ZIP code <span className="font-normal text-muted-foreground">optional</span>
              </Label>
              <Input
                id="card-zip"
                value={card.postalCode}
                inputMode="numeric"
                autoComplete="postal-code"
                className="tabular-nums"
                onChange={(e) => set({ postalCode: e.target.value })}
              />
            </div>
          </div>
          <p className="m-0 mt-4 text-xs text-muted-foreground tabular-nums">
            Test mode. 4242 4242 4242 4242 pays; 4000 0000 0000 0002 is declined.
          </p>
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
