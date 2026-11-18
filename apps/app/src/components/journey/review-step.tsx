import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { PdfPreview } from "@pas/ui/components/pdf-preview";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check } from "lucide-react";
import type * as React from "react";
import { useMemo, useState } from "react";
import { formatDateTime } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import type { StepProps } from "./journey";

export const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export function ReviewStep({ quote, submission, go }: StepProps) {
  const trpc = useTRPC();
  const [pages, setPages] = useState<number | null>(null);

  const packet = useQuery({
    ...trpc.quotes.packet.queryOptions({
      submissionId: submission.id,
      revision: quote.revision,
      updatedAt: quote.updatedAt,
    }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const pdf = useMemo(() => (packet.data ? fromBase64(packet.data.pdf) : null), [packet.data]);
  const count = packet.data?.documents.length;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <Panel
        title="Documents"
        description={
          count === undefined
            ? "Preparing the application, quote and policy forms…"
            : `${count} documents${pages ? ` · ${pages} pages` : ""}, built from this quote.`
        }
        flush
      >
        {packet.error ? (
          <div className="p-(--card-p)">
            <Notice tone="error" title="Couldn't prepare the documents">
              {packet.error.message}
            </Notice>
          </div>
        ) : (
          <div className="max-h-[calc(100svh-14rem)] overflow-y-auto bg-muted/40 p-4 sm:p-6">
            <PdfPreview data={pdf} label="Application packet" onRendered={setPages} />
          </div>
        )}
      </Panel>
      <SignPanel quote={quote} submission={submission} go={go} />
    </div>
  );
}

function SignPanel({ quote, submission, go }: StepProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState("");
  const sign = useMutation(trpc.quotes.sign.mutationOptions());
  const signer = quote.details.namedInsureds.find(Boolean) ?? "";

  if (quote.signature) {
    return (
      <Panel title="Signed" className="lg:sticky lg:top-20">
        <div className="grid gap-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
              <Check className="size-3" strokeWidth={3} />
            </span>
            <p className="m-0 text-sm">
              {quote.signature.signerName} signed on{" "}
              <span className="tabular-nums">{formatDateTime(quote.signature.signedAt)}</span>.
            </p>
          </div>
          <Button onClick={() => go("pay")}>
            Continue to payment <ArrowRight />
          </Button>
        </div>
      </Panel>
    );
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    sign.mutate(
      { submissionId: submission.id, typedName: name, agreed: true },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(
            trpc.quotes.get.queryKey({ submissionId: submission.id }),
            updated,
          );
        },
      },
    );
  }

  return (
    <Panel
      title="Sign the application"
      description={`${signer || "The named insured"} signs to apply for this policy.`}
      className="lg:sticky lg:top-20"
    >
      <form onSubmit={onSubmit} className="grid gap-5">
        <div className="flex items-start gap-3">
          <Checkbox
            id="agree"
            checked={agreed}
            onCheckedChange={(on) => setAgreed(on === true)}
            className="mt-0.5"
          />
          <Label htmlFor="agree" className="leading-5 font-normal">
            I've read these documents and agree to their terms.
          </Label>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="signature">Type your full name to sign</Label>
          <Input
            id="signature"
            value={name}
            placeholder={signer}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5" aria-hidden>
          <span className="h-9 truncate border-b border-foreground/70 font-serif text-2xl leading-9 italic">
            {name}
          </span>
          <span className="text-xs text-muted-foreground">Signature</span>
        </div>
        <p className="m-0 text-xs text-muted-foreground">{quote.signatureConsent}</p>
        {sign.error && (
          <Notice tone="error" title="Couldn't sign">
            {sign.error.message}
          </Notice>
        )}
        <Button type="submit" disabled={!agreed || !name.trim() || sign.isPending}>
          {sign.isPending && <Spinner />}
          Sign
        </Button>
      </form>
    </Panel>
  );
}
