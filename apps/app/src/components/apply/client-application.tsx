import type { AppOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { PdfPreview } from "@pas/ui/components/pdf-preview";
import { Spinner } from "@pas/ui/components/spinner";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Lock } from "lucide-react";
import type * as React from "react";
import { useId, useMemo, useState } from "react";
import {
  type CardDraft,
  CardFields,
  cardInput,
  cardReady,
  EMPTY_CARD,
  TestCardHint,
} from "@/components/card-fields";
import { fromBase64 } from "@/components/journey/review-step";
import { StripeProvider, useStripeCard } from "@/components/stripe-card";
import { formatDateTime, formatMoney, formatPlainDateRange } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

type Application = AppOutputs["clientApplication"]["get"];
type Payment = { card: ReturnType<typeof cardInput> } | { paymentToken: string };
type Locked = string | false;

const ABOVE = "Finish the step above first.";

export function ClientApplication({
  token,
  onWrongAccount,
}: {
  token: string;
  onWrongAccount: () => Promise<void>;
}) {
  const trpc = useTRPC();

  const application = useQuery({
    ...trpc.clientApplication.get.queryOptions({ token }),
    retry: false,
  });

  if (application.error) {
    const wrong = application.error.data?.code === "FORBIDDEN";

    return (
      <div className="grid max-w-xl gap-4">
        <Notice tone="error" title={wrong ? "This link is for someone else" : "Couldn't open this"}>
          {application.error.message}
        </Notice>
        {wrong && (
          <Button variant="outline" className="justify-self-start" onClick={onWrongAccount}>
            Sign in with another email
          </Button>
        )}
      </div>
    );
  }

  if (!application.data) return <div className="h-96 animate-pulse rounded-xl bg-muted/60" />;

  return <Steps token={token} app={application.data} />;
}

function Steps({ token, app }: { token: string; app: Application }) {
  const { rules, quote } = app;
  const disclosuresDone = app.disclosures.every((d) => d.acceptedAt);
  const signed = !!app.signature;
  const bound = quote.status === "bound";
  const insuredDiscloses = rules.disclosures === "insured" && app.disclosures.length > 0;
  const insuredSigns = rules.signature === "insured";
  const insuredPays = rules.payment !== "producer";

  const insuredRemaining =
    (insuredDiscloses && !disclosuresDone) || (insuredSigns && !signed) || (insuredPays && !bound);

  const waitingOnAgent = !bound && !insuredRemaining;

  const payLocked = !disclosuresDone
    ? insuredDiscloses
      ? ABOVE
      : `${app.request.sentBy} is finishing the disclosures first.`
    : !signed
      ? insuredSigns
        ? ABOVE
        : `You can pay once ${app.request.sentBy} has signed the application.`
      : false;

  let number = 0;

  return (
    <>
      <div className="grid gap-1">
        <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">
          Your {quote.productName} application
        </h1>
        <p className="m-0 text-sm text-muted-foreground tabular-nums">
          Prepared by {app.request.sentBy} · {quote.submissionNumber}
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-6">
          {bound && <BoundNotice app={app} />}
          {!bound && waitingOnAgent && (
            <Notice title="You're done for now">
              {app.request.sentBy} will finish the rest and let you know when the policy is in
              place.
            </Notice>
          )}
          {insuredDiscloses && (
            <Disclosures token={token} app={app} number={++number} done={disclosuresDone} />
          )}
          {insuredSigns && (
            <SignStep
              token={token}
              app={app}
              number={++number}
              locked={!disclosuresDone && ABOVE}
              done={signed}
            />
          )}
          {insuredPays && !bound && (
            <PayStep token={token} app={app} number={++number} locked={payLocked} />
          )}
        </div>
        <Summary app={app} />
      </div>
    </>
  );
}

function useSetApplication(token: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return (next: Application) =>
    queryClient.setQueryData(trpc.clientApplication.get.queryKey({ token }), next);
}

function StepPanel({
  number,
  title,
  description,
  done,
  locked,
  children,
}: {
  number: number;
  title: string;
  description?: React.ReactNode;
  done?: boolean;
  locked?: Locked;
  children: React.ReactNode;
}) {
  return (
    <Panel
      title={
        <span className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ring-1",
              done
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-muted text-muted-foreground ring-border",
            )}
          >
            {done ? <Check className="size-3.5" strokeWidth={3} /> : number}
          </span>
          {title}
        </span>
      }
      description={description}
      className={cn(locked && "opacity-60")}
    >
      {locked ? <p className="m-0 text-sm text-muted-foreground">{locked}</p> : children}
    </Panel>
  );
}

function Disclosures({
  token,
  app,
  number,
  done,
}: {
  token: string;
  app: Application;
  number: number;
  done: boolean;
}) {
  const trpc = useTRPC();
  const setApplication = useSetApplication(token);
  const pending = app.disclosures.filter((d) => !d.acceptedAt);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const accept = useMutation(
    trpc.clientApplication.acceptDisclosures.mutationOptions({ onSuccess: setApplication }),
  );

  return (
    <StepPanel
      number={number}
      title="Review the disclosures"
      description="Confirm each statement is true."
      done={done}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          accept.mutate({ token, codes: [...checked] });
        }}
      >
        <ul className="m-0 grid list-none gap-3 p-0">
          {app.disclosures.map((d) => (
            <li key={d.code} className="rounded-lg border p-4">
              <div className="flex items-start gap-3">
                {d.acceptedAt ? (
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm bg-emerald-600 text-white">
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                ) : (
                  <Checkbox
                    id={`ack-${d.code}`}
                    className="mt-0.5"
                    checked={checked.has(d.code)}
                    onCheckedChange={(on) =>
                      setChecked((current) => {
                        const next = new Set(current);

                        if (on === true) next.add(d.code);
                        else next.delete(d.code);

                        return next;
                      })
                    }
                  />
                )}
                <div className="grid gap-1">
                  <Label htmlFor={`ack-${d.code}`} className="leading-5">
                    {d.title}
                  </Label>
                  <p className="m-0 text-sm text-muted-foreground">{d.statement}</p>
                  {d.acceptedAt && (
                    <p className="m-0 text-xs text-muted-foreground tabular-nums">
                      Accepted {formatDateTime(d.acceptedAt)}
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {accept.error && (
          <Notice tone="error" title="Couldn't save">
            {accept.error.message}
          </Notice>
        )}
        {pending.length > 0 && (
          <Button
            type="submit"
            className="justify-self-end"
            disabled={checked.size !== pending.length || accept.isPending}
          >
            {accept.isPending && <Spinner />}
            Accept and continue
          </Button>
        )}
      </form>
    </StepPanel>
  );
}

function SignStep({
  token,
  app,
  number,
  locked,
  done,
}: {
  token: string;
  app: Application;
  number: number;
  locked: Locked;
  done: boolean;
}) {
  const trpc = useTRPC();
  const setApplication = useSetApplication(token);
  const [agreed, setAgreed] = useState(false);
  const [name, setName] = useState("");
  const [pages, setPages] = useState<number | null>(null);

  const sign = useMutation(
    trpc.clientApplication.sign.mutationOptions({ onSuccess: setApplication }),
  );

  const signer = app.quote.namedInsureds.find(Boolean) ?? "";

  const packet = useQuery({
    ...trpc.clientApplication.packet.queryOptions({
      token,
      revision: app.quote.revision,
      updatedAt: app.quote.updatedAt,
    }),
    enabled: !locked,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const pdf = useMemo(() => (packet.data ? fromBase64(packet.data.pdf) : null), [packet.data]);

  return (
    <StepPanel
      number={number}
      title="Review and sign"
      description={
        packet.data
          ? `${packet.data.documents.length} documents${pages ? ` · ${pages} pages` : ""}`
          : "Your application, quote and policy forms."
      }
      done={done}
      locked={locked}
    >
      <div className="grid gap-5">
        {packet.error ? (
          <Notice tone="error" title="Couldn't prepare the documents">
            {packet.error.message}
          </Notice>
        ) : (
          <div className="max-h-[32rem] overflow-y-auto rounded-lg bg-muted/40 p-4">
            <PdfPreview data={pdf} label="Application packet" onRendered={setPages} />
          </div>
        )}
        {app.signature ? (
          <p className="m-0 flex items-center gap-2 text-sm">
            <Check className="size-4 text-emerald-700" strokeWidth={3} />
            {app.signature.signerName} signed on{" "}
            <span className="tabular-nums">{formatDateTime(app.signature.signedAt)}</span>.
          </p>
        ) : (
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault();
              sign.mutate({ token, typedName: name, agreed: true });
            }}
          >
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
            <p className="m-0 text-xs text-muted-foreground">{app.signatureConsent}</p>
            {sign.error && (
              <Notice tone="error" title="Couldn't sign">
                {sign.error.message}
              </Notice>
            )}
            <Button
              type="submit"
              className="justify-self-end"
              disabled={!agreed || !name.trim() || sign.isPending || !packet.data}
            >
              {sign.isPending && <Spinner />}
              Sign
            </Button>
          </form>
        )}
      </div>
    </StepPanel>
  );
}

function PayStep(props: { token: string; app: Application; number: number; locked: Locked }) {
  const trpc = useTRPC();

  const checkout = useQuery({
    ...trpc.clientApplication.checkout.queryOptions(),
    enabled: !props.locked,
  });

  if (props.locked || !checkout.data) {
    return (
      <StepPanel number={props.number} title="Pay" locked={props.locked}>
        {checkout.error ? (
          <Notice tone="error" title="Couldn't load payment">
            {checkout.error.message}
          </Notice>
        ) : (
          <div className="h-40 animate-pulse rounded-lg bg-muted/40" />
        )}
      </StepPanel>
    );
  }

  return checkout.data.kind === "stripe" ? (
    <StripeProvider publishableKey={checkout.data.publishableKey}>
      <StripePay {...props} testMode={checkout.data.testMode} />
    </StripeProvider>
  ) : (
    <CardPay {...props} />
  );
}

function CardPay(props: { token: string; app: Application; number: number }) {
  const [card, setCard] = useState<CardDraft>(EMPTY_CARD);

  return (
    <PayForm
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

function StripePay(props: { token: string; app: Application; number: number; testMode: boolean }) {
  const card = useStripeCard();

  return (
    <PayForm
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

function PayForm({
  token,
  app,
  number,
  fields,
  ready,
  payment,
}: {
  token: string;
  app: Application;
  number: number;
  fields: React.ReactNode;
  ready: boolean;
  payment: () => Promise<Payment>;
}) {
  const trpc = useTRPC();
  const setApplication = useSetApplication(token);
  const id = useId();
  const [notice, setNotice] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [autopay, setAutopay] = useState(true);
  const plan = app.quote.payPlan;
  const installments = !!plan && plan.installments > 1;
  const due = plan?.dueToday ?? app.quote.premium.total;
  const pay = useMutation(trpc.clientApplication.pay.mutationOptions());
  const busy = collecting || pay.isPending;

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

    pay.mutate(
      { token, ...method, autopay: installments && autopay },
      {
        onSuccess: (result) => {
          setApplication(result.application);

          if (result.status === "payment_declined")
            setNotice(`${result.message} Try another card.`);
        },
      },
    );
  }

  return (
    <StepPanel
      number={number}
      title="Pay"
      description={
        plan ? `${plan.label}. Due today ${formatMoney(due, { cents: true })}.` : undefined
      }
    >
      <form onSubmit={onSubmit} className="grid gap-4">
        {fields}
        {installments && (
          <div className="flex items-start gap-3 rounded-lg border px-3 py-3">
            <Checkbox
              id={`${id}-autopay`}
              checked={autopay}
              onCheckedChange={(on) => setAutopay(on === true)}
              className="mt-0.5"
            />
            <Label htmlFor={`${id}-autopay`} className="grid gap-1 font-normal">
              <span className="font-medium">Pay installments automatically with this card</span>
              <span className="text-xs text-muted-foreground">{app.autopayConsent}</span>
            </Label>
          </div>
        )}
        {(notice || pay.error) && (
          <Notice tone="error" title={notice ? "Payment declined" : "Couldn't pay"}>
            {notice ?? pay.error?.message}
          </Notice>
        )}
        <Button type="submit" className="justify-self-end" disabled={!ready || busy}>
          {busy ? <Spinner /> : <Lock />}
          Pay {formatMoney(due, { cents: true })}
        </Button>
      </form>
    </StepPanel>
  );
}

function BoundNotice({ app }: { app: Application }) {
  return (
    <Panel title="You're covered">
      <div className="grid gap-4">
        <p className="m-0 text-sm">
          {app.quote.policy
            ? `Your policy ${app.quote.policy.number} is in place.`
            : "Your policy is in place."}{" "}
          We've emailed your documents. You can see them any time in your account.
        </p>
        <Button asChild className="justify-self-start">
          <Link to="/portal">Go to your policies</Link>
        </Button>
      </div>
    </Panel>
  );
}

function Summary({ app }: { app: Application }) {
  const { quote } = app;

  return (
    <Panel
      title={quote.insuredName}
      description={formatPlainDateRange(quote.term.start, quote.term.end)}
      className="lg:sticky lg:top-6"
    >
      <dl className="m-0 grid gap-2 text-sm">
        {quote.coverages.map((c) => (
          <div key={c.code} className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{c.name}</dt>
            <dd className="m-0 tabular-nums">{formatMoney(c.premium, { cents: true })}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t pt-2">
          <dt className="text-muted-foreground">Taxes and fees</dt>
          <dd className="m-0 tabular-nums">
            {formatMoney(quote.premium.taxesFees, { cents: true })}
          </dd>
        </div>
        <div className="flex justify-between gap-4 font-semibold">
          <dt>Total</dt>
          <dd className="m-0 tabular-nums">{formatMoney(quote.premium.total, { cents: true })}</dd>
        </div>
      </dl>
    </Panel>
  );
}
