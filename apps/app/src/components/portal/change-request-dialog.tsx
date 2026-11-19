import type { AddressValue } from "@pas/forms-core";
import { AddressField } from "@pas/forms-react";
import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { RadioGroup, RadioGroupItem } from "@pas/ui/components/radio-group";
import { Spinner } from "@pas/ui/components/spinner";
import { Textarea } from "@pas/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc";

const KINDS = [
  { value: "address", label: "Mailing address" },
  { value: "mortgagee", label: "Mortgagee or lender" },
  { value: "coverage", label: "Coverage" },
  { value: "other", label: "Something else" },
] as const;

type Kind = (typeof KINDS)[number]["value"];

export function ChangeRequestDialog({
  policyId,
  agentName,
  open,
  onOpenChange,
}: {
  policyId: string;
  agentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<Kind>("address");
  const [details, setDetails] = useState("");
  const [address, setAddress] = useState<AddressValue | undefined>();
  const withAddress = kind === "address" && Boolean(address?.addressId);
  const create = useMutation(trpc.client.changeRequests.create.mutationOptions());

  const close = () => {
    onOpenChange(false);
    setKind("address");
    setDetails("");
    setAddress(undefined);
    create.reset();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    create.mutate(
      { policyId, kind, details, ...(withAddress && { address }) },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({
            queryKey: trpc.client.policies.get.queryKey({ id: policyId }),
          });

          close();
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>Request a change</DialogTitle>
            <DialogDescription>{agentName} will review it and get back to you.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>What would you like to change?</Label>
            <RadioGroup value={kind} onValueChange={(value) => setKind(value as Kind)}>
              {KINDS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors has-data-[state=checked]:border-primary/40 has-data-[state=checked]:bg-primary/5"
                >
                  <RadioGroupItem value={option.value} />
                  {option.label}
                </label>
              ))}
            </RadioGroup>
          </div>
          {kind === "address" && (
            <div className="grid gap-2">
              <span className="text-sm leading-none font-medium">New mailing address</span>
              <AddressField
                id="change-address"
                value={address}
                onChange={setAddress}
                country="US"
              />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="change-details">
              Details
              {kind === "address" && (
                <span className="font-normal text-muted-foreground"> Optional</span>
              )}
            </Label>
            <Textarea
              id="change-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="What should change, and from when"
            />
          </div>
          {create.error && (
            <Notice tone="error" title="Couldn't send the request">
              {create.error.message}
            </Notice>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={(details.trim().length < 3 && !withAddress) || create.isPending}
            >
              {create.isPending && <Spinner />}
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
