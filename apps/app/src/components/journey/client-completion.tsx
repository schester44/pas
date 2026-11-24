import type { AppOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import type * as React from "react";
import { useId, useState } from "react";
import { formatDateTime } from "@/lib/format";
import type { Quote } from "@/lib/quotes";
import { useTRPC } from "@/lib/trpc";

export type Completion = AppOutputs["quotes"]["completion"];
export type CompletionStep = keyof Completion["rules"];

const WAITING = new Set(["sent", "opened"]);

/** Who completes each step, polled while the insured has a link open so their progress shows up. */
export function useCompletion(submissionId: string) {
  const trpc = useTRPC();

  const completion = useQuery({
    ...trpc.quotes.completion.queryOptions({ submissionId }),
    refetchInterval: (query) =>
      WAITING.has(query.state.data?.request?.status ?? "") ? 10_000 : false,
  });

  const waiting = WAITING.has(completion.data?.request?.status ?? "");

  useQuery({
    ...trpc.quotes.get.queryOptions({ submissionId }),
    refetchInterval: waiting ? 10_000 : false,
  });

  return completion.data;
}

export const insuredOwns = (completion: Completion | undefined, step: CompletionStep) =>
  completion?.rules[step] === "insured";

const REQUEST_STATUS: Record<string, string> = {
  sent: "Sent",
  opened: "Opened",
  completed: "Completed",
  revoked: "Replaced by a newer link",
  expired: "Expired",
};

/** The producer's view of the insured's part: what's done, and the link that gets them there. */
export function ClientCompletionPanel({
  quote,
  submissionId,
  completion,
  title,
  className,
}: {
  quote: Quote;
  submissionId: string;
  completion: Completion;
  title: string;
  className?: string;
}) {
  const [sending, setSending] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const { rules, request } = completion;
  const disclosures = quote.requirements.filter((r) => r.kind === "attestation");
  const accepted = disclosures.filter((r) => r.satisfied).length;
  const signature = quote.signature;
  const live = request && WAITING.has(request.status);

  const steps = [
    rules.disclosures === "insured" &&
      disclosures.length > 0 && {
        label: "Disclosures",
        done: accepted === disclosures.length,
        detail: `${accepted} of ${disclosures.length} accepted`,
      },
    rules.signature === "insured" && {
      label: "Signature",
      done: !!signature,
      detail: signature
        ? `${signature.signerName}, ${formatDateTime(signature.signedAt)}`
        : "Not signed yet",
    },
    rules.payment !== "producer" && {
      label: rules.payment === "either" ? "Payment (insured or you)" : "Payment",
      done: quote.status === "bound",
      detail: quote.status === "bound" ? "Paid" : "Not paid yet",
    },
  ].filter((step) => !!step);

  return (
    <Panel title={title} className={className}>
      <div className="grid gap-5">
        <ul className="m-0 grid list-none gap-3 p-0">
          {steps.map((step) => (
            <li key={step.label} className="flex items-start gap-3">
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ring-1",
                  step.done
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                    : "bg-muted text-muted-foreground ring-border",
                )}
              >
                {step.done && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span className="grid gap-0.5">
                <span className="text-sm leading-5 font-medium">{step.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{step.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="grid gap-1 border-t pt-4 text-sm">
          {request ? (
            <>
              <span>
                {REQUEST_STATUS[request.status]} to{" "}
                <span className="font-medium">{request.email}</span>
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                Sent {formatDateTime(request.sentAt)} by {request.sentBy}
                {request.openedAt && ` · Opened ${formatDateTime(request.openedAt)}`}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">Not sent to the insured yet.</span>
          )}
        </div>
        {url && <CopyLink url={url} />}
        {request?.status !== "completed" && (
          <Button variant={live ? "outline" : "default"} onClick={() => setSending(true)}>
            {live ? "Resend or change email" : "Send to the insured"}
          </Button>
        )}
      </div>
      <Dialog open={sending} onOpenChange={setSending}>
        <DialogContent className="sm:max-w-md">
          {sending && (
            <SendForm
              submissionId={submissionId}
              defaults={{
                name: request?.name ?? quote.details.namedInsureds.find(Boolean) ?? "",
                email: request?.email ?? quote.insuredEmail ?? "",
              }}
              onSent={(link) => {
                setUrl(link);
                setSending(false);
              }}
              onCancel={() => setSending(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function SendForm({
  submissionId,
  defaults,
  onSent,
  onCancel,
}: {
  submissionId: string;
  defaults: { name: string; email: string };
  onSent: (url: string) => void;
  onCancel: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const id = useId();
  const [name, setName] = useState(defaults.name);
  const [email, setEmail] = useState(defaults.email);

  const send = useMutation(
    trpc.quotes.sendToClient.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries({
          queryKey: trpc.quotes.completion.queryKey({ submissionId }),
        });

        onSent(result.url);
      },
    }),
  );

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    send.mutate({ submissionId, name: name.trim(), email: email.trim() });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <DialogHeader>
        <DialogTitle>Send to the insured</DialogTitle>
        <DialogDescription>
          They get a link, confirm their email with a one-time code, then finish their steps.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input
            id={`${id}-name`}
            value={name}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-email`}>Email</Label>
          <Input
            id={`${id}-email`}
            type="email"
            value={email}
            autoComplete="off"
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>
      {send.error && (
        <Notice tone="error" title="Couldn't send">
          {send.error.message}
        </Notice>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || !email.trim() || send.isPending}>
          {send.isPending && <Spinner />}
          Send link
        </Button>
      </DialogFooter>
    </form>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="grid gap-2">
      <Label htmlFor="client-link" className="text-xs font-normal text-muted-foreground">
        Or share the link yourself
      </Label>
      <div className="flex gap-2">
        <Input id="client-link" value={url} readOnly className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={copied ? "Copied" : "Copy link"}
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}
