import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { Input } from "@pas/ui/components/input";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Field } from "@/components/distribution/agency-dialog";
import { formatMoney } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";
import type { Policy } from "./policy-format";

/** Producer and agency of record, the commission the policy has earned, and broker of record changes. */
export function ProducerOfRecord({ policy }: { policy: Policy }) {
  const trpc = useTRPC();
  const access = useAccess();
  const [changing, setChanging] = useState(false);

  const commissions = useQuery({
    ...trpc.distribution.policyCommissions.queryOptions({ policyId: policy.id }),
    enabled: access.agencies.read,
  });

  const total = (commissions.data ?? []).reduce((sum, c) => sum + Number(c.amount.amount), 0);
  const currency = commissions.data?.[0]?.amount.currency ?? policy.total.currency;

  return (
    <Panel
      title="Producer of record"
      action={
        access.policies.update &&
        access.agencies.read && (
          <Button size="sm" variant="outline" onClick={() => setChanging(true)}>
            Change producer
          </Button>
        )
      }
    >
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <div className="grid gap-1">
          <dt className="text-xs text-muted-foreground">Producer</dt>
          <dd className="m-0 text-sm font-medium">{policy.producerName}</dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-xs text-muted-foreground">Agency</dt>
          <dd className="m-0 text-sm font-medium">
            {policy.agencyId ? (
              <Link
                to="/agencies/$agencyId"
                params={{ agencyId: policy.agencyId }}
                className="hover:underline"
              >
                {policy.producerAgency}
              </Link>
            ) : (
              (policy.producerAgency ?? "—")
            )}
          </dd>
        </div>
        {access.agencies.read && (
          <div className="grid gap-1">
            <dt className="text-xs text-muted-foreground">Commission earned</dt>
            <dd className="m-0 text-sm font-medium tabular-nums">
              {commissions.isPending ? (
                <span className="inline-block h-4 w-16 animate-pulse rounded bg-muted" />
              ) : total === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <>
                  {formatMoney({ amount: total.toFixed(2), currency })}
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    on {commissions.data?.length}{" "}
                    {commissions.data?.length === 1 ? "line" : "lines"}
                  </span>
                </>
              )}
            </dd>
          </div>
        )}
      </dl>
      <ChangeProducerDialog policy={policy} open={changing} onOpenChange={setChanging} />
    </Panel>
  );
}

function ChangeProducerDialog({
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
  const [agencyId, setAgencyId] = useState("");
  const [producerId, setProducerId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const agencies = useQuery({ ...trpc.distribution.agencies.list.queryOptions(), enabled: open });

  const agency = useQuery({
    ...trpc.distribution.agencies.get.queryOptions({ id: agencyId }),
    enabled: open && Boolean(agencyId),
  });

  const change = useMutation(
    trpc.distribution.changeProducer.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.policies.pathKey() });
        await queryClient.invalidateQueries({ queryKey: trpc.distribution.pathKey() });
        onOpenChange(false);
      },
    }),
  );

  const producers = (agency.data?.producers ?? []).filter((p) => p.userId);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setAgencyId("");
          setProducerId("");
          setReason("");
        }

        change.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change producer of record</DialogTitle>
          <DialogDescription>
            {policy.number} moves to the new producer and agency from the effective date. The client
            portal shows them as the insured's agent.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();

            if (!agencyId || !producerId) return;

            change.mutate({ policyId: policy.id, agencyId, producerId, effectiveDate, reason });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Agency" id="bor-agency">
              <Select
                value={agencyId}
                onValueChange={(next) => {
                  setAgencyId(next);
                  setProducerId("");
                }}
              >
                <SelectTrigger id="bor-agency">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {agencies.data?.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Producer" id="bor-producer">
              <Select value={producerId} disabled={!agencyId} onValueChange={setProducerId}>
                <SelectTrigger id="bor-producer">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {producers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Effective" id="bor-effective">
              <Input
                id="bor-effective"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </Field>
            <Field label="Reason" id="bor-reason" optional>
              <Input
                id="bor-reason"
                value={reason}
                placeholder="Broker of record letter"
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
          {change.error && <Notice tone="error">{change.error.message}</Notice>}
          <DialogFooter className="pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!agencyId || !producerId || change.isPending}>
              {change.isPending && <Spinner />}
              Change producer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
