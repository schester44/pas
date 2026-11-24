import { Card } from "@pas/ui/components/card";
import { IconTile } from "@pas/ui/components/icon-tile";
import { Notice } from "@pas/ui/components/notice";
import { Spinner } from "@pas/ui/components/spinner";
import { Landmark } from "lucide-react";
import type * as React from "react";
import type { Quote } from "@/lib/quotes";

/** True while the carrier is quoting or binding, so the journey keeps polling. */
export const withCarrier = (quote: Quote | null | undefined) =>
  quote?.carrier?.status === "pending_carrier" ||
  quote?.carrier?.bind?.status === "pending_carrier";

/** Why the carrier didn't price the quote; while it's pricing, the figures show as crunching. */
export function CarrierQuote({ quote }: { quote: Quote }) {
  const carrier = quote.carrier;

  if (!carrier || carrier.status === "pending_carrier" || carrier.status === "quoted") return null;

  const text = carrier.messages.map((m) => m.text).join(" ");

  return (
    <Notice
      tone={carrier.status === "failed" ? "error" : "warning"}
      title={
        carrier.status === "referred"
          ? `${carrier.name} referred this quote`
          : carrier.status === "declined"
            ? `${carrier.name} declined this quote`
            : `${carrier.name} couldn't quote`
      }
    >
      {text || "Requote to try again, or contact the carrier."}
    </Notice>
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
