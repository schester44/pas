import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type * as React from "react";
import { formatPlainDate } from "@/lib/format";

interface HeadingSubmission {
  number: string;
  /** What the agent is quoting: the offering until an option is chosen, then the product. */
  title: string;
  jurisdiction: { country: string; subdivision?: string };
  effectiveDate: string;
}

export function SubmissionHeading({
  submission,
  aside,
}: {
  submission: HeadingSubmission;
  aside?: React.ReactNode;
}) {
  return (
    <div className="grid gap-3">
      <BackLink />
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="grid min-w-0 gap-1">
          <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">
            {submission.title}
          </h1>
          <p className="m-0 text-sm text-muted-foreground tabular-nums">
            {submission.number} · {jurisdictionName(submission.jurisdiction)} · Effective{" "}
            {formatPlainDate(submission.effectiveDate)}
          </p>
        </div>
        {aside}
      </div>
    </div>
  );
}

export function BackLink() {
  return (
    <Link
      to="/"
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground"
    >
      <ArrowLeft aria-hidden className="size-4" /> Home
    </Link>
  );
}
