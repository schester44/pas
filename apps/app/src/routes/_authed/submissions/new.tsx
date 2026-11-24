import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import { jurisdictionName, subdivisionsOf } from "@pas/ui/lib/jurisdictions";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { useState } from "react";
import { formatList } from "@/lib/format";
import { isUnavailable, unavailableMessage } from "@/lib/submissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/submissions/new")({
  component: StartQuotePage,
});

const COUNTRY = "US";

interface Window {
  jurisdiction: { country: string; subdivision?: string };
  from: string;
  to?: string;
}

const covers = (window: Window, subdivision: string, date: string) =>
  window.jurisdiction.subdivision === subdivision &&
  window.from <= date &&
  (window.to === undefined || date < window.to);

function StartQuotePage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const offerings = useQuery(trpc.submissions.availableOfferings.queryOptions({}));
  const [chosenId, setChosenId] = useState<string>();
  const [subdivision, setSubdivision] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

  const offering = offerings.data?.find((o) => o.id === chosenId) ?? offerings.data?.[0];
  const offered = new Set(offering?.availability.map((w) => w.jurisdiction.subdivision));
  const states = subdivisionsOf(COUNTRY);
  const ready = !!offering && !!subdivision && !!effectiveDate;

  const unavailable =
    ready && !offering.availability.some((window) => covers(window, subdivision, effectiveDate));

  const start = useMutation(
    trpc.submissions.start.mutationOptions({
      onSuccess: async (submission) => {
        queryClient.setQueryData(trpc.submissions.get.queryKey({ id: submission.id }), submission);

        void queryClient.invalidateQueries({ queryKey: trpc.submissions.list.queryKey() });

        await navigate({
          to: "/submissions/$submissionId",
          params: { submissionId: submission.id },
        });
      },
    }),
  );

  const startError =
    start.error &&
    (isUnavailable(start.error.data?.details)
      ? unavailableMessage(start.error.data.details)
      : start.error.message);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!ready) return;

    start.mutate({
      offeringId: offering.id,
      jurisdiction: { country: COUNTRY, subdivision },
      effectiveDate,
    });
  }

  if (offerings.data?.length === 0) {
    return (
      <div className="mx-auto grid w-full max-w-2xl gap-6">
        <Heading />
        <Panel>
          <EmptyState
            icon={<Layers />}
            title="Nothing to quote yet"
            description="No products are open for new business."
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <Heading />
      <form onSubmit={onSubmit} className="grid gap-6">
        <Panel title="Product">
          {offerings.error ? (
            <Notice tone="error" title="Couldn't load products">
              {offerings.error.data?.code === "FORBIDDEN"
                ? "Ask your administrator for access to start quotes."
                : "Refresh the page to try again."}
            </Notice>
          ) : offerings.isPending ? (
            <div className="h-16 animate-pulse rounded-lg bg-muted/60" />
          ) : (
            <div role="radiogroup" aria-label="Product" className="grid gap-2">
              {offerings.data?.map((option) => {
                const selected = option.id === offering?.id;

                const where = [
                  ...new Set(option.availability.map((w) => jurisdictionName(w.jurisdiction))),
                ];

                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setChosenId(option.id);
                      start.reset();
                    }}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      selected ? "border-primary/40 bg-primary/5" : "hover:bg-muted/40",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full border bg-background",
                        selected && "border-primary",
                      )}
                    >
                      {selected && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className="text-sm leading-5 font-medium">{option.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        Available in {formatList(where)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
        <Panel title="Risk location and timing">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <Label htmlFor="state">State</Label>
              <Select
                value={subdivision}
                onValueChange={(next) => {
                  setSubdivision(next);
                  start.reset();
                }}
              >
                <SelectTrigger id="state">
                  <SelectValue placeholder="Choose a state" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {offered.size > 0 && (
                    <>
                      <SelectGroup>
                        <SelectLabel>Available</SelectLabel>
                        {states
                          .filter(([code]) => offered.has(code))
                          .map(([code, name]) => (
                            <SelectItem key={code} value={code}>
                              {name}
                            </SelectItem>
                          ))}
                      </SelectGroup>
                      <SelectSeparator />
                    </>
                  )}
                  <SelectGroup>
                    <SelectLabel>All states</SelectLabel>
                    {states
                      .filter(([code]) => !offered.has(code))
                      .map(([code, name]) => (
                        <SelectItem key={code} value={code}>
                          {name}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="grid content-start gap-2">
              <Label htmlFor="effectiveDate">Effective date</Label>
              <Input
                id="effectiveDate"
                type="date"
                value={effectiveDate}
                className="tabular-nums"
                onChange={(event) => {
                  setEffectiveDate(event.target.value);
                  start.reset();
                }}
              />
            </div>
          </div>
          {unavailable && offering && (
            <p role="status" className="m-0 mt-4 flex items-start gap-2 text-sm">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
              <span>
                {unavailableMessage({
                  productName: offering.name,
                  jurisdiction: { country: COUNTRY, subdivision },
                  effectiveDate,
                })}{" "}
                <span className="text-muted-foreground">Choose another state or date.</span>
              </span>
            </p>
          )}
        </Panel>
        {startError && !unavailable && (
          <Notice tone="error" title="Couldn't start the quote">
            {startError}
          </Notice>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" asChild>
            <Link to="/">Cancel</Link>
          </Button>
          <Button type="submit" disabled={!ready || unavailable || start.isPending}>
            {start.isPending && <Spinner />}
            Start quote
          </Button>
        </div>
      </form>
    </div>
  );
}

function Heading() {
  return (
    <div className="grid gap-1">
      <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">Start a quote</h1>
      <p className="m-0 text-sm text-muted-foreground">
        Pick a product, where the risk is and when coverage starts.
      </p>
    </div>
  );
}
