import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import { IconTile } from "@pas/ui/components/icon-tile";
import { cn } from "@pas/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { CalendarX, CircleSlash, Clock } from "lucide-react";
import type * as React from "react";
import { formatDate, formatDateTime, formatMoney, formatPlainDate } from "@/lib/format";
import type { Quote } from "@/lib/quotes";
import { approvalChanges, UnderwriterMessages } from "@/components/underwriting";
import type { StepProps } from "./journey";

type ScreenProps = StepProps & { heading: React.ReactNode };

function Screen({
  heading,
  icon,
  title,
  description,
  children,
  actions,
}: {
  heading: React.ReactNode;
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  children?: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <>
      {heading}
      <Card className="w-full max-w-3xl">
        <div className="flex gap-4 p-(--card-p)">
          <IconTile>{icon}</IconTile>
          <div className="grid gap-1 pt-0.5">
            <h2 className="m-0 text-base leading-6 font-semibold">{title}</h2>
            <p className="m-0 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {children && <div className="grid gap-6 border-t p-(--card-p)">{children}</div>}
        <div className="flex flex-wrap justify-end gap-2 border-t bg-muted/50 px-(--card-p) py-3">
          {actions}
        </div>
      </Card>
    </>
  );
}

function Reasons({
  title,
  reasons,
  tone,
}: {
  title: string;
  reasons: { reasonCode: string; message: string }[];
  tone: "warning" | "danger";
}) {
  return (
    <section className="grid gap-3">
      <h3 className="m-0 text-sm font-medium">{title}</h3>
      <ul className="m-0 grid list-none gap-2 p-0">
        {reasons.map((reason) => (
          <li key={reason.reasonCode} className="flex items-start gap-2.5 text-sm">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                tone === "warning" ? "bg-amber-500" : "bg-red-500",
              )}
            />
            {reason.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Facts({ facts }: { facts: [string, React.ReactNode][] }) {
  return (
    <dl className="m-0 grid gap-4 sm:grid-cols-3">
      {facts.map(([label, value]) => (
        <div key={label} className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="m-0 text-sm tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const HomeButton = () => (
  <Button variant="outline" asChild>
    <Link to="/">Back to home</Link>
  </Button>
);

export function ReferredScreen({ quote, submission, heading }: ScreenProps) {
  const referral = quote.referral!;

  return (
    <Screen
      heading={heading}
      icon={<Clock />}
      title="An underwriter is reviewing this quote"
      description={
        <>
          They'll respond by{" "}
          <span className="text-foreground tabular-nums">{formatDateTime(referral.reviewBy)}</span>.
          The quote is saved, and once it's approved you'll pick up right where you left off.
        </>
      }
      actions={<HomeButton />}
    >
      <Reasons title="Why it needs a review" reasons={referral.reasons} tone="warning" />
      <UnderwriterMessages submissionId={submission.id} />
      <Facts
        facts={[
          ["Indicative total", formatMoney(quote.premium.total, { cents: true })],
          ["Referred", formatDateTime(referral.referredAt)],
          ["Quote valid until", formatPlainDate(quote.expiresAt.slice(0, 10))],
        ]}
      />
    </Screen>
  );
}

export function DeclinedScreen({ quote, heading }: ScreenProps) {
  const byUnderwriter = quote.referral?.decision?.outcome === "declined";

  return (
    <Screen
      heading={heading}
      icon={<CircleSlash />}
      title="We can't offer coverage for this risk"
      description={
        byUnderwriter
          ? `An underwriter declined it on ${formatDate(quote.referral!.decision!.decidedAt)}.`
          : "It's outside what this product can cover."
      }
      actions={
        <>
          <HomeButton />
          <Button asChild>
            <Link to="/submissions/new">Start another quote</Link>
          </Button>
        </>
      }
    >
      <Reasons title="Why" reasons={quote.declineReasons} tone="danger" />
      {quote.referral?.decision?.note && (
        <p className="m-0 text-sm text-muted-foreground">{quote.referral.decision.note}</p>
      )}
      {quote.referral?.decision?.adverseActionNotice && (
        <p className="m-0 text-xs whitespace-pre-wrap text-muted-foreground">
          {quote.referral.decision.adverseActionNotice}
        </p>
      )}
    </Screen>
  );
}

export function ExpiredScreen({ quote, heading }: ScreenProps) {
  return (
    <Screen
      heading={heading}
      icon={<CalendarX />}
      title="This quote expired"
      description={`It was valid until ${formatPlainDate(quote.expiresAt.slice(0, 10))}. Start a new quote to continue.`}
      actions={
        <>
          <HomeButton />
          <Button asChild>
            <Link to="/submissions/new">Start a new quote</Link>
          </Button>
        </>
      }
    />
  );
}

export function ApprovedCallout({ quote }: { quote: Quote }) {
  const decision = quote.referral?.decision;

  if (!decision) return null;

  return (
    <div role="status" className="grid gap-1 text-sm">
      <p className="m-0 flex items-start gap-2.5">
        <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
        <span>
          Approved by {decision.by} on {formatDate(decision.decidedAt)}.{" "}
          <span className="text-muted-foreground">You can continue to bind.</span>
        </span>
      </p>
      {approvalChanges(quote).length > 0 && (
        <ul className="m-0 grid list-none gap-0.5 pl-4 text-muted-foreground">
          {approvalChanges(quote).map((change) => (
            <li key={change}>Changed: {change}</li>
          ))}
        </ul>
      )}
      {decision.conditions.length > 0 && (
        <ul className="m-0 grid list-none gap-0.5 pl-4 text-muted-foreground">
          {decision.conditions.map((condition) => (
            <li key={condition}>Condition: {condition}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
