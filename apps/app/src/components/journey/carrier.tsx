import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import { IconTile } from "@pas/ui/components/icon-tile";
import { Notice } from "@pas/ui/components/notice";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@pas/ui/components/sheet";
import { Spinner } from "@pas/ui/components/spinner";
import { cn } from "@pas/ui/lib/utils";
import { Landmark } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { formatMoney, formatSignedMoney } from "@/lib/format";
import type { Quote } from "@/lib/quotes";

type Carrier = NonNullable<Quote["carrier"]>;

const money = (amount: string, currency: string) => ({ amount, currency });

/** True while the carrier is quoting or binding, so the journey keeps polling. */
export const withCarrier = (quote: Quote | null | undefined) =>
  quote?.carrier?.status === "pending_carrier" ||
  quote?.carrier?.bind?.status === "pending_carrier";

/** The carrier's side of the quote on the quote step (PLAN §12): waiting, its figures, or why not. */
export function CarrierQuote({ quote }: { quote: Quote }) {
  const carrier = quote.carrier;
  const [why, setWhy] = useState(false);

  if (!carrier) return null;

  if (carrier.status === "pending_carrier") {
    return (
      <Callout>
        <Spinner className="size-3.5" />
        Waiting for {carrier.name}'s quote. The price below is our rating until it answers.
      </Callout>
    );
  }

  if (carrier.status !== "quoted") {
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

  const diff = carrier.diff;
  const moved = diff && Number(diff.difference) !== 0;

  return (
    <>
      <Callout>
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
        <span className="min-w-0 flex-1">
          {carrier.figuresWin
            ? `${carrier.name}'s figures`
            : `${carrier.name} confirmed our figures`}
          {moved && diff && (
            <span className="text-muted-foreground tabular-nums">
              {" "}
              · {formatSignedMoney(money(diff.difference, diff.currency))} against our rating of{" "}
              {formatMoney(money(diff.pasTotal, diff.currency), { cents: true })}
            </span>
          )}
          {carrier.reference && (
            <span className="text-muted-foreground"> · ref. {carrier.reference}</span>
          )}
        </span>
        {diff && diff.changes.length > 0 && (
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setWhy(true)}>
            Why?
          </Button>
        )}
      </Callout>
      {diff && <FiguresSheet open={why} onOpenChange={setWhy} carrier={carrier} />}
    </>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm">
      {children}
    </div>
  );
}

function FiguresSheet({
  open,
  onOpenChange,
  carrier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  carrier: Carrier;
}) {
  const diff = carrier.diff!;

  const show = (amount: string | null) =>
    amount === null ? "–" : formatMoney(money(amount, diff.currency), { cents: true });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{carrier.name}'s figures win</SheetTitle>
          <SheetDescription>
            The product lets the carrier's premium, taxes and fees replace ours. These lines moved.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <table className="w-full text-sm">
            <thead>
              <tr className="h-9 border-b text-xs text-muted-foreground">
                <th className="text-left font-medium">Line</th>
                <th className="text-right font-medium">Ours</th>
                <th className="text-right font-medium">{carrier.name.split(" ")[0]}</th>
                <th className="text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {diff.changes.map((change) => (
                <tr key={change.key} className="h-10 border-b">
                  <td>{change.label}</td>
                  <td className="text-right tabular-nums">{show(change.pas)}</td>
                  <td className="text-right tabular-nums">{show(change.carrier)}</td>
                  <td
                    className={cn(
                      "text-right tabular-nums",
                      Number(change.difference) < 0 ? "text-emerald-700" : "",
                    )}
                  >
                    {formatSignedMoney(money(change.difference, diff.currency))}
                  </td>
                </tr>
              ))}
              <tr className="h-10 font-semibold">
                <td>Total</td>
                <td className="text-right tabular-nums">{show(diff.pasTotal)}</td>
                <td className="text-right tabular-nums">{show(diff.carrierTotal)}</td>
                <td className="text-right tabular-nums">
                  {formatSignedMoney(money(diff.difference, diff.currency))}
                </td>
              </tr>
            </tbody>
          </table>
        </SheetBody>
      </SheetContent>
    </Sheet>
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
