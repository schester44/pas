import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
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
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc";
import type { Agency } from "./format";

const NO_PARENT = "none";

type Draft = {
  name: string;
  parentId: string;
  legalName: string;
  fein: string;
  email: string;
  phone: string;
  tier: string;
  status: Agency["status"];
  line1: string;
  city: string;
  region: string;
  postalCode: string;
  eligible: boolean;
  remittanceDays: string;
  creditLimit: string;
  remittanceBasis: "gross" | "net";
  commissionBasis: "default" | "written" | "collected";
  statementDay: string;
  reminderDays: string;
  suspendAfterDays: string;
  nonpaymentCancels: boolean;
};

const draftOf = (agency: Agency | undefined, parentId?: string): Draft => ({
  name: agency?.name ?? "",
  parentId: agency?.parentId ?? parentId ?? NO_PARENT,
  legalName: agency?.legalName ?? "",
  fein: agency?.fein ?? "",
  email: agency?.email ?? "",
  phone: agency?.phone ?? "",
  tier: agency?.tier ?? "standard",
  status: agency?.status ?? "active",
  line1: agency?.address?.line1 ?? "",
  city: agency?.address?.city ?? "",
  region: agency?.address?.region ?? "",
  postalCode: agency?.address?.postalCode ?? "",
  eligible: agency?.billing.eligible ?? false,
  remittanceDays: agency?.billing.remittanceDays?.toString() ?? "",
  creditLimit: agency?.billing.creditLimit?.amount ?? "",
  remittanceBasis: agency?.billing.remittanceBasis ?? "gross",
  commissionBasis: agency?.billing.commissionBasis ?? "default",
  statementDay: agency?.billing.statementDay?.toString() ?? "",
  reminderDays: agency?.billing.reminderDays?.toString() ?? "",
  suspendAfterDays: agency?.billing.suspendAfterDays?.toString() ?? "",
  nonpaymentCancels: agency?.billing.nonpaymentCancels ?? false,
});

const days = (value: string) => (value ? Number(value) : null);

/** Creates an agency or edits one, including its place in the hierarchy and agency-bill terms. */
export function AgencyDialog({
  open,
  onOpenChange,
  agency,
  parentId,
  canMove = true,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agency?: Agency;
  parentId?: string;
  canMove?: boolean;
  onSaved?: (agency: Agency) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const agencies = useQuery({ ...trpc.distribution.agencies.list.queryOptions(), enabled: open });
  const [draft, setDraft] = useState(() => draftOf(agency, parentId));
  const [submitted, setSubmitted] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = useMutation(
    trpc.distribution.agencies.save.mutationOptions({
      onSuccess: async (saved) => {
        await queryClient.invalidateQueries({ queryKey: trpc.distribution.pathKey() });
        onSaved?.(saved);
        onOpenChange(false);
      },
    }),
  );

  const hasAddress =
    draft.line1.trim() && draft.city.trim() && draft.region.trim() && draft.postalCode.trim();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);

    if (!draft.name.trim()) return;

    save.mutate({
      ...(agency && { id: agency.id }),
      parentId: draft.parentId === NO_PARENT ? null : draft.parentId,
      name: draft.name,
      legalName: draft.legalName || null,
      fein: draft.fein || null,
      email: draft.email || null,
      phone: draft.phone || null,
      tier: draft.tier,
      status: draft.status,
      address: hasAddress
        ? {
            line1: draft.line1,
            city: draft.city,
            region: draft.region,
            postalCode: draft.postalCode,
            country: agency?.address?.country ?? "US",
          }
        : null,
      billing: {
        eligible: draft.eligible,
        remittanceDays: draft.remittanceDays ? Number(draft.remittanceDays) : null,
        creditLimit: draft.creditLimit || null,
        remittanceBasis: draft.remittanceBasis,
        commissionBasis: draft.commissionBasis === "default" ? null : draft.commissionBasis,
        statementDay: days(draft.statementDay),
        reminderDays: days(draft.reminderDays),
        suspendAfterDays: days(draft.suspendAfterDays),
        nonpaymentCancels: draft.nonpaymentCancels,
      },
    });
  }

  const parents = (agencies.data ?? []).filter((a) => a.id !== agency?.id);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(draftOf(agency, parentId));

        setSubmitted(false);
        save.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{agency ? "Edit agency" : "New agency"}</DialogTitle>
          <DialogDescription>
            {agency
              ? "Details, hierarchy and agency-bill terms."
              : "Add an agency, branch or sub-agency."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid max-h-[65vh] gap-4 overflow-y-auto px-0.5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Name"
              id="agency-name"
              error={submitted && !draft.name.trim() ? "Enter a name." : null}
            >
              <Input
                id="agency-name"
                value={draft.name}
                autoFocus
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
            <Field label="Parent agency" id="agency-parent">
              <Select
                value={draft.parentId}
                disabled={!canMove}
                onValueChange={(next) => set({ parentId: next })}
              >
                <SelectTrigger id="agency-parent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT}>None (top level)</SelectItem>
                  {parents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Legal name" id="agency-legal" optional>
              <Input
                id="agency-legal"
                value={draft.legalName}
                onChange={(e) => set({ legalName: e.target.value })}
              />
            </Field>
            <Field label="FEIN" id="agency-fein" optional>
              <Input
                id="agency-fein"
                value={draft.fein}
                placeholder="12-3456789"
                onChange={(e) => set({ fein: e.target.value })}
              />
            </Field>
            <Field label="Email" id="agency-email" optional>
              <Input
                id="agency-email"
                type="email"
                value={draft.email}
                onChange={(e) => set({ email: e.target.value })}
              />
            </Field>
            <Field label="Phone" id="agency-phone" optional>
              <Input
                id="agency-phone"
                value={draft.phone}
                onChange={(e) => set({ phone: e.target.value })}
              />
            </Field>
            <Field label="Street address" id="agency-line1" optional>
              <Input
                id="agency-line1"
                value={draft.line1}
                onChange={(e) => set({ line1: e.target.value })}
              />
            </Field>
            <Field label="City" id="agency-city" optional>
              <Input
                id="agency-city"
                value={draft.city}
                onChange={(e) => set({ city: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="State" id="agency-region" optional>
                <Input
                  id="agency-region"
                  value={draft.region}
                  onChange={(e) => set({ region: e.target.value })}
                />
              </Field>
              <Field label="ZIP" id="agency-zip" optional>
                <Input
                  id="agency-zip"
                  value={draft.postalCode}
                  onChange={(e) => set({ postalCode: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Commission tier" id="agency-tier">
                <Input
                  id="agency-tier"
                  value={draft.tier}
                  onChange={(e) => set({ tier: e.target.value })}
                />
              </Field>
              <Field label="Status" id="agency-status">
                <Select
                  value={draft.status}
                  onValueChange={(status) => set({ status: status as Draft["status"] })}
                >
                  <SelectTrigger id="agency-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suspended">Suspended</SelectItem>
                    <SelectItem value="terminated">Terminated</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Commission payable" id="agency-commission">
                <Select
                  value={draft.commissionBasis}
                  onValueChange={(value) =>
                    set({ commissionBasis: value as Draft["commissionBasis"] })
                  }
                >
                  <SelectTrigger id="agency-commission">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">By billing method</SelectItem>
                    <SelectItem value="written">When written</SelectItem>
                    <SelectItem value="collected">As premium is collected</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>
          <div className="grid gap-4 rounded-lg bg-muted/50 p-4">
            <label className="flex items-center gap-2.5 text-sm font-medium">
              <Checkbox
                checked={draft.eligible}
                onCheckedChange={(checked) => set({ eligible: checked === true })}
              />
              Eligible for agency bill
            </label>
            {draft.eligible && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Remittance due (days)" id="agency-remit" optional>
                  <Input
                    id="agency-remit"
                    inputMode="numeric"
                    value={draft.remittanceDays}
                    onChange={(e) => set({ remittanceDays: e.target.value.replace(/\D/g, "") })}
                  />
                </Field>
                <Field label="Credit limit (USD)" id="agency-credit" optional>
                  <Input
                    id="agency-credit"
                    inputMode="decimal"
                    value={draft.creditLimit}
                    onChange={(e) => set({ creditLimit: e.target.value.replace(/[^\d.]/g, "") })}
                  />
                </Field>
                <Field label="Remittance" id="agency-basis">
                  <Select
                    value={draft.remittanceBasis}
                    onValueChange={(value) =>
                      set({ remittanceBasis: value as Draft["remittanceBasis"] })
                    }
                  >
                    <SelectTrigger id="agency-basis">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gross">Gross</SelectItem>
                      <SelectItem value="net">Net of commission</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Statement cut-off day" id="agency-cutoff" optional>
                  <Input
                    id="agency-cutoff"
                    inputMode="numeric"
                    placeholder="Month end"
                    value={draft.statementDay}
                    onChange={(e) =>
                      set({ statementDay: e.target.value.replace(/\D/g, "").slice(0, 2) })
                    }
                  />
                </Field>
                <Field label="Reminder (days past due)" id="agency-remind" optional>
                  <Input
                    id="agency-remind"
                    inputMode="numeric"
                    value={draft.reminderDays}
                    onChange={(e) => set({ reminderDays: e.target.value.replace(/\D/g, "") })}
                  />
                </Field>
                <Field label="Suspend agency bill (days past due)" id="agency-suspend" optional>
                  <Input
                    id="agency-suspend"
                    inputMode="numeric"
                    value={draft.suspendAfterDays}
                    onChange={(e) => set({ suspendAfterDays: e.target.value.replace(/\D/g, "") })}
                  />
                </Field>
                <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
                  <Checkbox
                    checked={draft.nonpaymentCancels}
                    onCheckedChange={(checked) => set({ nonpaymentCancels: checked === true })}
                  />
                  Start nonpayment on unpaid items when agency bill is suspended
                </label>
              </div>
            )}
          </div>
          {save.error && <Notice tone="error">{save.error.message}</Notice>}
          <DialogFooter className="pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              {agency ? "Save agency" : "Create agency"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Field({
  label,
  id,
  optional,
  error,
  children,
}: {
  label: string;
  id: string;
  optional?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">Optional</span>}
      </Label>
      {children}
      {error && <p className="m-0 text-xs text-destructive">{error}</p>}
    </div>
  );
}
