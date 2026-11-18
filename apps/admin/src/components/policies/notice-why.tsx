import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@pas/ui/components/sheet";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import {
  deliveryLabel,
  noticeExplanation,
  plainDate,
  recipientLabel,
} from "@pas/ui/lib/policy-change";

export interface NoticeBasis {
  jurisdiction: { country: string; subdivision?: string };
  reasonLabel: string;
  initiator: string;
  noticeDate: string;
  earliestDate: string;
  atInception: boolean;
  rule: {
    minDaysNotice: number;
    mailingDaysAdded: number;
    delivery: string;
    recipients: string[];
    source: { version: string; fallback: boolean };
  };
}

export function noticeSentence(basis: NoticeBasis) {
  return noticeExplanation({
    jurisdictionName: jurisdictionName(basis.jurisdiction),
    reasonLabel: basis.reasonLabel,
    initiator: basis.initiator,
    minDaysNotice: basis.rule.minDaysNotice,
    mailingDaysAdded: basis.rule.mailingDaysAdded,
    atInception: basis.atInception,
  });
}

/** "Why this date?": the notice rule behind the earliest valid cancellation date. */
export function NoticeWhy({ basis }: { basis: NoticeBasis }) {
  const facts: [string, string][] = [
    ["Notice date", plainDate(basis.noticeDate)],
    ["Days of notice", `${basis.rule.minDaysNotice}`],
    ["Added for mailing", `${basis.rule.mailingDaysAdded}`],
    ["Earliest valid date", plainDate(basis.earliestDate)],
    ["Delivery", deliveryLabel(basis.rule.delivery)],
    ["Recipients", basis.rule.recipients.map(recipientLabel).join(", ")],
    ["Rule", `Notice rules, version ${basis.rule.source.version}`],
  ];

  return (
    <Sheet>
      <SheetTrigger className="font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline">
        Why this date?
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Earliest valid cancellation date</SheetTitle>
          <SheetDescription>{noticeSentence(basis)}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <dl className="m-0 grid divide-y rounded-lg border">
            {facts.map(([term, value]) => (
              <div
                key={term}
                className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3 px-3 py-2.5 text-sm"
              >
                <dt className="text-muted-foreground">{term}</dt>
                <dd className="m-0 tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0 text-sm text-muted-foreground">
            {basis.rule.source.fallback
              ? `This policy's version predates notice rules, so the newest published version for ${jurisdictionName(basis.jurisdiction)} decides: notice law applies on the notice date.`
              : "From the notice rules on the policy's product version."}{" "}
            The notice is sent electronically today; proof of mailing is recorded once print and
            mail is connected.
          </p>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
