import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PremiumChange } from "@pas/ui/components/premium-change";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import { Spinner } from "@pas/ui/components/spinner";
import { Textarea } from "@pas/ui/components/textarea";
import { plainDate } from "@pas/ui/lib/policy-change";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, FilePen, RotateCcw, Undo2, XCircle } from "lucide-react";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc";

type Policy = AdminOutputs["policies"]["get"];

/** Endorse, cancel, rescind and reinstate, offered by term state and the member's authority. */
export function PolicyActions({ policy }: { policy: Policy }) {
  const trpc = useTRPC();
  const authority = useQuery(trpc.policies.changes.authority.queryOptions({ policyId: policy.id }));
  const [dialog, setDialog] = useState<"rescind" | "reinstate" | null>(null);

  if (!authority.data?.create) return null;

  const changeable = policy.status === "pending_effective" || policy.status === "in_force";
  const pendingCancellation = policy.status === "pending_cancellation";
  const cancelled = policy.status === "cancelled";
  const issue = authority.data.issue;

  if (!changeable && !(issue && (pendingCancellation || cancelled))) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Actions <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {changeable && (
            <>
              <DropdownMenuItem asChild>
                <Link to="/policies/$policyId/endorse" params={{ policyId: policy.id }}>
                  <FilePen /> Change policy
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/policies/$policyId/cancel" params={{ policyId: policy.id }}>
                  <XCircle /> Cancel policy
                </Link>
              </DropdownMenuItem>
            </>
          )}
          {pendingCancellation && issue && (
            <DropdownMenuItem onSelect={() => setDialog("rescind")}>
              <Undo2 /> Rescind cancellation
            </DropdownMenuItem>
          )}
          {cancelled && issue && (
            <DropdownMenuItem onSelect={() => setDialog("reinstate")}>
              <RotateCcw /> Reinstate policy
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <RescindDialog
        policy={policy}
        open={dialog === "rescind"}
        onOpenChange={(open) => !open && setDialog(null)}
      />
      {dialog === "reinstate" && (
        <ReinstateDialog policy={policy} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

export function RescindDialog({
  policy,
  open,
  onOpenChange,
}: {
  policy: Policy;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const rescind = useMutation(
    trpc.policies.changes.rescindCancellation.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.policies.pathKey() });
        onOpenChange(false);
      },
    }),
  );

  const date = policy.cancellation?.effectiveDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rescind the cancellation</DialogTitle>
          <DialogDescription>
            {date
              ? `The cancellation scheduled for ${plainDate(date)} is withdrawn and coverage continues.`
              : "Coverage continues."}{" "}
            Nothing is billed.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="rescind-note">
            Reason <span className="font-normal text-muted-foreground">Optional</span>
          </Label>
          <Textarea
            id="rescind-note"
            rows={3}
            placeholder="Payment received"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {rescind.error && (
          <Notice tone="error" title="Couldn't rescind">
            {rescind.error.message}
          </Notice>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep cancellation
          </Button>
          <Button
            disabled={rescind.isPending}
            onClick={() =>
              rescind.mutate({ policyId: policy.id, ...(note.trim() && { note: note.trim() }) })
            }
          >
            {rescind.isPending && <Spinner />} Rescind cancellation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReinstateDialog({ policy, onClose }: { policy: Policy; onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [lapse, setLapse] = useState<"none" | "lapse">("none");
  const [date, setDate] = useState("");

  const quote = useQuery({
    ...trpc.policies.changes.quoteReinstatement.queryOptions({
      policyId: policy.id,
      lapse: lapse === "lapse",
      ...(lapse === "lapse" && date && { effectiveDate: date }),
    }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const reinstate = useMutation(
    trpc.policies.changes.reinstate.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.policies.pathKey() });
        onClose();
      },
    }),
  );

  const q = quote.data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reinstate the policy</DialogTitle>
          <DialogDescription>
            {q
              ? `Cancelled ${plainDate(q.cancelledOn)}. Reinstatement is open until ${plainDate(q.windowEnds)}.`
              : "Restores coverage and bills the premium back."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <SegmentedControl
            label="Lapse in coverage"
            value={lapse}
            onValueChange={setLapse}
            options={[
              { value: "none", label: "Without a lapse" },
              { value: "lapse", label: "With a lapse" },
            ]}
          />
          {lapse === "lapse" && q && (
            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="reinstate-date">Coverage resumes</Label>
              <Input
                id="reinstate-date"
                type="date"
                className="tabular-nums"
                min={q.cancelledOn}
                value={date || q.effectiveDate}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          )}
          {quote.error ? (
            <Notice tone="error" title="Can't reinstate">
              {quote.error.message}
            </Notice>
          ) : q ? (
            <div className="rounded-lg border p-4">
              <PremiumChange preview={q.preview} />
            </div>
          ) : (
            <div className="h-32 animate-pulse rounded-lg bg-muted/60" />
          )}
          {reinstate.error && (
            <Notice tone="error" title="Couldn't reinstate">
              {reinstate.error.message}
            </Notice>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Not now
          </Button>
          <Button
            disabled={!q || reinstate.isPending || !!quote.error}
            onClick={() =>
              reinstate.mutate({
                policyId: policy.id,
                lapse: lapse === "lapse",
                ...(lapse === "lapse" && q && { effectiveDate: q.effectiveDate }),
              })
            }
          >
            {reinstate.isPending && <Spinner />} Reinstate policy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
