import { StepIndicator } from "@pas/forms-react";
import { Notice } from "@pas/ui/components/notice";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type * as React from "react";
import { formatPlainDate } from "@/lib/format";
import { furthestStep, type Quote, resumeStep, STEPS, type StepId } from "@/lib/quotes";
import { useTRPC } from "@/lib/trpc";
import { SubmissionHeading } from "@/components/submission-heading";
import { SubjectivitiesList, UnderwriterMessages } from "@/components/underwriting";
import { BoundScreen } from "./bound-screen";
import { insuredOwns, useCompletion } from "./client-completion";
import { CarrierBindFailed, CarrierBinding, CarrierQuote, withCarrier } from "./carrier";
import { CustomizeStep } from "./customize-step";
import { DetailsStep } from "./details-step";
import { PayStep } from "./pay-step";
import { QuoteStep } from "./quote-step";
import { ReviewStep } from "./review-step";
import { ApprovedCallout, DeclinedScreen, ExpiredScreen, ReferredScreen } from "./status-screens";

export interface JourneySubmission {
  id: string;
  number: string;
  productName: string;
  jurisdiction: { country: string; subdivision?: string };
  effectiveDate: string;
}

export interface StepProps {
  quote: Quote;
  submission: JourneySubmission;
  go: (step: StepId) => void;
}

export function Journey({
  submission,
  step,
}: {
  submission: JourneySubmission;
  step: StepId | undefined;
}) {
  const trpc = useTRPC();
  const navigate = useNavigate();

  const quote = useQuery(
    trpc.quotes.get.queryOptions(
      { submissionId: submission.id },
      { refetchInterval: (query) => (withCarrier(query.state.data) ? 2000 : false) },
    ),
  );

  const completion = useCompletion(submission.id);

  const insured = {
    disclosures: insuredOwns(completion, "disclosures"),
    signature: insuredOwns(completion, "signature"),
  };

  const heading = (aside?: React.ReactNode) => (
    <SubmissionHeading submission={submission} aside={aside} />
  );

  const go = (next: StepId) => {
    void navigate({
      to: "/submissions/$submissionId",
      params: { submissionId: submission.id },
      search: { step: next },
    });

    window.scrollTo({ top: 0 });
  };

  if (quote.error) {
    return (
      <>
        {heading()}
        <Notice tone="error" title="Couldn't load this quote">
          Refresh the page to try again.
        </Notice>
      </>
    );
  }

  if (quote.isPending) return <JourneySkeleton heading={heading()} />;

  if (!quote.data) {
    return (
      <>
        {heading()}
        <Notice title="Not quoted yet">This submission doesn't have a quote.</Notice>
      </>
    );
  }

  const q = quote.data;
  const props = { quote: q, submission, go };

  if (q.status === "bound") return <BoundScreen {...props} />;

  if (q.carrier?.bind?.status === "pending_carrier")
    return <CarrierBinding quote={q} heading={heading()} />;

  if (q.status === "referred") return <ReferredScreen {...props} heading={heading()} />;

  if (q.status === "declined") return <DeclinedScreen {...props} heading={heading()} />;

  if (q.status === "expired") return <ExpiredScreen {...props} heading={heading()} />;

  const furthest = furthestStep(q, insured);
  const wanted = step ?? resumeStep(q, insured);

  const index = Math.min(
    STEPS.findIndex((s) => s.id === wanted),
    furthest,
  );

  const current = STEPS[index]!.id;

  return (
    <>
      {heading(
        <p className="m-0 text-xs text-muted-foreground tabular-nums">
          Valid until {formatPlainDate(q.expiresAt.slice(0, 10))}
        </p>,
      )}
      <StepIndicator
        steps={[...STEPS]}
        current={index}
        label={`Step ${index + 1} of ${STEPS.length}: ${STEPS[index]!.title}`}
        onSelect={(target) => go(STEPS[target]!.id)}
        reachable={furthest}
      />
      {q.approved && (current === "quote" || current === "details") && (
        <ApprovedCallout quote={q} />
      )}
      {q.approved && current === "quote" && <UnderwriterMessages submissionId={submission.id} />}
      {(current === "quote" || current === "pay") && (
        <SubjectivitiesList submissionId={submission.id} />
      )}
      {(current === "quote" || current === "review") && <CarrierQuote quote={q} />}
      {current === "pay" && <CarrierBindFailed quote={q} />}
      {current === "quote" && <QuoteStep {...props} />}
      {current === "customize" && <CustomizeStep {...props} />}
      {current === "details" && <DetailsStep {...props} />}
      {current === "review" && <ReviewStep {...props} />}
      {current === "pay" && <PayStep {...props} />}
    </>
  );
}

function JourneySkeleton({ heading }: { heading: React.ReactNode }) {
  return (
    <div className="grid gap-6" aria-busy>
      {heading}
      <div className="h-8 w-full animate-pulse rounded-md bg-muted/60" />
      <div className="h-72 animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}
