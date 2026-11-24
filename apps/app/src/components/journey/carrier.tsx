import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import { IconTile } from "@pas/ui/components/icon-tile";
import { Notice } from "@pas/ui/components/notice";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Landmark, RotateCw } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import type { Quote } from "@/lib/quotes";
import { useTRPC } from "@/lib/trpc";

// How long the agent watches a carrier price before we offer to ask again; carriers that answer
// later still can, until the agent retries.
const STALL_MS = 45_000;

/** True while the carrier is quoting or binding, so the journey keeps polling. */
export const withCarrier = (quote: Quote | null | undefined) =>
  quote?.carrier?.status === "pending_carrier" ||
  quote?.carrier?.bind?.status === "pending_carrier";

/** The carrier prices this quote and its price isn't on it (yet). */
export const awaitsCarrierPrice = (quote: Quote) =>
  quote.carrier?.rating === "carrier" && quote.carrier.status !== "quoted";

/**
 * `pricing` while the carrier works on a price we're waiting for; `stalled` once a pending
 * carrier has gone quiet; `noPrice` when the figures are the carrier's and it has none to show.
 */
export function useCarrierPhase(quote: Quote) {
  const pending = quote.carrier?.status === "pending_carrier";
  const since = Date.parse(quote.carrier?.updatedAt ?? quote.updatedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!pending) return;

    const wait = since + STALL_MS - Date.now();

    if (wait <= 0) return;

    const timer = window.setTimeout(() => setNow(Date.now()), wait);

    return () => window.clearTimeout(timer);
  }, [pending, since]);

  const stalled = pending && now - since >= STALL_MS;
  const pricing = awaitsCarrierPrice(quote) && pending && !stalled;

  return { pricing, stalled, noPrice: awaitsCarrierPrice(quote) && !pricing };
}

/** Why the carrier has no price on the quote, with a retry when it failed or went quiet. */
export function CarrierQuote({ quote }: { quote: Quote }) {
  const carrier = quote.carrier;
  const { stalled } = useCarrierPhase(quote);

  if (!carrier || carrier.status === "quoted") return null;

  if (stalled) {
    return (
      <Notice
        tone="warning"
        title={`${carrier.name} hasn't answered`}
        action={<RetryCarrier quote={quote} />}
      >
        The carrier is taking longer than usual. Ask again, or wait for it to answer.
      </Notice>
    );
  }

  if (carrier.status === "pending_carrier") return null;

  const text = carrier.messages.map((m) => m.text).join(" ");
  const failed = carrier.status === "failed";

  return (
    <Notice
      tone={failed ? "error" : "warning"}
      title={
        carrier.status === "referred"
          ? `${carrier.name} referred this quote`
          : carrier.status === "declined"
            ? `${carrier.name} declined this quote`
            : `${carrier.name} couldn't quote`
      }
      {...(failed && { action: <RetryCarrier quote={quote} /> })}
    >
      {text || (failed ? "Ask the carrier again." : "Contact the carrier.")}
    </Notice>
  );
}

function RetryCarrier({ quote }: { quote: Quote }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const key = trpc.quotes.get.queryKey({ submissionId: quote.submissionId });

  const retry = useMutation(
    trpc.quotes.retryCarrier.mutationOptions({
      onSuccess: (updated) => queryClient.setQueryData(key, updated),
    }),
  );

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={retry.isPending}
      onClick={() => retry.mutate({ submissionId: quote.submissionId })}
    >
      {retry.isPending ? <Spinner className="size-3.5" /> : <RotateCw />}
      Retry
    </Button>
  );
}

/** A carrier-owned bind in flight: the quote is `pending_carrier` until the carrier answers. */
export function CarrierBinding({ quote, heading }: { quote: Quote; heading: React.ReactNode }) {
  const carrier = quote.carrier!;
  const phase = carrier.bind?.phase === "issue" ? "issuing the policy" : "binding";

  return (
    <>
      {heading}
      <Card className="w-full max-w-3xl">
        <div className="flex gap-4 p-(--card-p)">
          <IconTile>
            <Landmark />
          </IconTile>
          <div className="grid gap-1 pt-0.5">
            <h2 className="m-0 flex items-center gap-2 text-base leading-6 font-semibold">
              With {carrier.name} <Spinner className="size-3.5" />
            </h2>
            <p className="m-0 text-sm text-muted-foreground">
              {carrier.name} is {phase}. The card is authorized and is charged only once the carrier
              issues; this page updates on its own.
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}

/** Shown on the pay step after a carrier refused to bind; the authorization was voided. */
export function CarrierBindFailed({ quote }: { quote: Quote }) {
  const bind = quote.carrier?.bind;

  if (bind?.status !== "failed") return null;

  return (
    <Notice tone="error" title={`${quote.carrier!.name} didn't bind`}>
      {bind.message} The card authorization was released; fix the issue with the carrier, then bind
      again.
    </Notice>
  );
}
