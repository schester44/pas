import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { Textarea } from "@pas/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/settings/underwriting")({
  component: UnderwritingSettingsPage,
});

type Settings = AdminOutputs["underwriting"]["settings"]["get"];
type Profile = Settings["authorityProfiles"][number];
type Reason = Settings["declineReasons"][number];

const limit = (value: string | null) =>
  value === null ? "No limit" : formatMoney({ amount: value, currency: "USD" });

const blankProfile = (level: number): Profile => ({
  key: "",
  name: "",
  level,
  maxPremium: null,
  maxInsuredValue: null,
  products: [],
  jurisdictions: [],
  roles: [],
  userIds: [],
});

function UnderwritingSettingsPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const access = useAccess();
  const settings = useQuery(trpc.underwriting.settings.get.queryOptions());
  const staff = useQuery(trpc.underwriting.settings.staff.queryOptions());
  const [profile, setProfile] = useState<{ index: number; value: Profile } | null>(null);
  const [reason, setReason] = useState<{ index: number; value: Reason } | null>(null);

  const save = useMutation(
    trpc.underwriting.settings.update.mutationOptions({
      onSuccess: (data) =>
        queryClient.setQueryData(trpc.underwriting.settings.get.queryKey(), data),
    }),
  );

  const data = settings.data;
  const names = new Map((staff.data ?? []).map((m) => [m.userId, m.name]));

  const update = (next: Partial<Settings>, onDone?: () => void) =>
    data && save.mutate({ ...data, ...next }, { onSuccess: () => onDone?.() });

  return (
    <>
      <PageHeader title="Underwriting" />
      <PageBody className="max-w-4xl gap-6">
        {settings.error && (
          <Notice tone="error" title="Couldn't load underwriting settings">
            {settings.error.message}
          </Notice>
        )}
        <Panel
          flush
          title="Authority"
          description="What each underwriter may approve. Approvals beyond it escalate to a higher level."
          action={
            access.underwriting.configure && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setProfile({
                    index: -1,
                    value: blankProfile((data?.authorityProfiles.length ?? 0) + 1),
                  })
                }
              >
                <Plus /> Add level
              </Button>
            )
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Level</TableHead>
                <TableHead className="text-right">Premium up to</TableHead>
                <TableHead className="text-right">Insured value up to</TableHead>
                <TableHead>Held by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.authorityProfiles ?? [])
                .map((p, index) => ({ p, index }))
                .toSorted((a, b) => a.p.level - b.p.level)
                .map(({ p, index }) => (
                  <TableRow
                    key={p.key}
                    className={
                      access.underwriting.configure ? "cursor-pointer hover:bg-muted/40" : undefined
                    }
                    onClick={() => access.underwriting.configure && setProfile({ index, value: p })}
                  >
                    <TableCell>
                      <span className="grid gap-0.5">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          Level {p.level} · <span className="font-mono">{p.key}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{limit(p.maxPremium)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {limit(p.maxInsuredValue)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {[
                        ...p.roles.map((r) => `${r.replaceAll("_", " ")} role`),
                        ...p.userIds.map((id) => names.get(id) ?? id),
                      ].join(", ") || <span className="text-muted-foreground">Nobody yet</span>}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </Panel>

        <Panel
          flush
          title="Decline reasons"
          description="The reasons underwriters can decline for, with the adverse-action wording each one uses."
          action={
            access.underwriting.configure && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setReason({ index: -1, value: { code: "", label: "", adverseActionNotice: "" } })
                }
              >
                <Plus /> Add reason
              </Button>
            )
          }
        >
          <ul className="m-0 list-none divide-y p-0">
            {(data?.declineReasons ?? []).map((r, index) => (
              <li key={r.code}>
                <button
                  type="button"
                  disabled={!access.underwriting.configure}
                  onClick={() => setReason({ index, value: r })}
                  className="grid w-full gap-0.5 px-(--card-p) py-3 text-left transition-colors hover:bg-muted/40 disabled:hover:bg-transparent"
                >
                  <span className="text-sm font-medium">{r.label}</span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    <span className="font-mono">{r.code}</span> ·{" "}
                    {r.adverseActionNotice || "No adverse-action wording"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <OverdueConsequence
          value={data?.overdueConsequence ?? ""}
          disabled={!access.underwriting.configure || !data}
          pending={save.isPending}
          onSave={(overdueConsequence) =>
            update({ overdueConsequence: overdueConsequence.trim() || null })
          }
        />

        {save.error && (
          <Notice tone="error" title="Couldn't save">
            {save.error.message}
          </Notice>
        )}
      </PageBody>

      <ProfileDialog
        state={profile}
        staff={staff.data ?? []}
        pending={save.isPending}
        onClose={() => setProfile(null)}
        onSave={(value) => {
          if (!data || !profile) return;

          const list = [...data.authorityProfiles];

          if (profile.index < 0) list.push(value);
          else list[profile.index] = value;

          update({ authorityProfiles: list }, () => setProfile(null));
        }}
      />
      <ReasonDialog
        state={reason}
        pending={save.isPending}
        onClose={() => setReason(null)}
        onSave={(value) => {
          if (!data || !reason) return;

          const list = [...data.declineReasons];

          if (reason.index < 0) list.push(value);
          else list[reason.index] = value;

          update({ declineReasons: list }, () => setReason(null));
        }}
      />
    </>
  );
}

function OverdueConsequence({
  value,
  disabled,
  pending,
  onSave,
}: {
  value: string;
  disabled: boolean;
  pending: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const current = draft ?? value;

  return (
    <Panel
      title="Overdue subjectivities"
      description="What an overdue post-bind subjectivity asks for, unless its rule says otherwise."
      footer={
        !disabled && (
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={pending || current === value}
              onClick={() => (onSave(current), setDraft(null))}
            >
              Save
            </Button>
          </div>
        )
      }
    >
      <div className="grid gap-2">
        <Label htmlFor="overdue-consequence">Consequence</Label>
        <Input
          id="overdue-consequence"
          value={current}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
    </Panel>
  );
}

const toggle = (list: string[], item: string, on: boolean) =>
  on ? [...new Set([...list, item])] : list.filter((x) => x !== item);

function ProfileDialog({
  state,
  staff,
  pending,
  onClose,
  onSave,
}: {
  state: { index: number; value: Profile } | null;
  staff: AdminOutputs["underwriting"]["settings"]["staff"];
  pending: boolean;
  onClose: () => void;
  onSave: (value: Profile) => void;
}) {
  const [draft, setDraft] = useState<Profile | null>(null);
  const value = draft ?? state?.value ?? null;
  const roles = [...new Set(["underwriter", ...staff.flatMap((m) => m.roles)])].toSorted();

  if (!value) return null;

  const set = (next: Partial<Profile>) => setDraft({ ...value, ...next });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    onSave({
      ...value!,
      key:
        value!.key ||
        value!.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, ""),
    });
  }

  return (
    <Dialog open={state !== null} onOpenChange={(next) => !next && (setDraft(null), onClose())}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={onSubmit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>{state?.index === -1 ? "Add an authority level" : value.name}</DialogTitle>
            <DialogDescription>
              Rules name a level by its key (for example senior_underwriter).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_6rem]">
            <div className="grid gap-2">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                value={value.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-level">Level</Label>
              <Input
                id="profile-level"
                type="number"
                min={1}
                max={10}
                className="tabular-nums"
                value={value.level}
                onChange={(e) => set({ level: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="profile-premium">
                Premium up to{" "}
                <span className="font-normal text-muted-foreground">blank is no limit</span>
              </Label>
              <Input
                id="profile-premium"
                inputMode="decimal"
                className="tabular-nums"
                value={value.maxPremium ?? ""}
                onChange={(e) => set({ maxPremium: e.target.value.trim() || null })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="profile-tiv">
                Insured value up to{" "}
                <span className="font-normal text-muted-foreground">blank is no limit</span>
              </Label>
              <Input
                id="profile-tiv"
                inputMode="decimal"
                className="tabular-nums"
                value={value.maxInsuredValue ?? ""}
                onChange={(e) => set({ maxInsuredValue: e.target.value.trim() || null })}
              />
            </div>
          </div>
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 text-sm font-medium">Held by roles</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {roles.map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={value.roles.includes(role)}
                    onCheckedChange={(on) => set({ roles: toggle(value.roles, role, on === true) })}
                  />
                  {role.replaceAll("_", " ")}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 text-sm font-medium">Held by people</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {staff.map((m) => (
                <label key={m.userId} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={value.userIds.includes(m.userId)}
                    onCheckedChange={(on) =>
                      set({ userIds: toggle(value.userIds, m.userId, on === true) })
                    }
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => (setDraft(null), onClose())}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !value.name.trim()}>
              {pending && <Spinner />}
              Save level
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({
  state,
  pending,
  onClose,
  onSave,
}: {
  state: { index: number; value: Reason } | null;
  pending: boolean;
  onClose: () => void;
  onSave: (value: Reason) => void;
}) {
  const [draft, setDraft] = useState<Reason | null>(null);
  const value = draft ?? state?.value ?? null;

  if (!value) return null;

  const set = (next: Partial<Reason>) => setDraft({ ...value, ...next });

  return (
    <Dialog open={state !== null} onOpenChange={(next) => !next && (setDraft(null), onClose())}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(value);
          }}
          className="grid gap-6"
        >
          <DialogHeader>
            <DialogTitle>{state?.index === -1 ? "Add a decline reason" : value.label}</DialogTitle>
            <DialogDescription>
              Compliance owns the wording; the system never writes it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <div className="grid gap-2">
              <Label htmlFor="reason-code">Code</Label>
              <Input
                id="reason-code"
                className="font-mono"
                value={value.code}
                onChange={(e) => set({ code: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reason-label">Label</Label>
              <Input
                id="reason-label"
                value={value.label}
                onChange={(e) => set({ label: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="reason-notice">Adverse-action wording</Label>
            <Textarea
              id="reason-notice"
              rows={4}
              value={value.adverseActionNotice}
              onChange={(e) => set({ adverseActionNotice: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => (setDraft(null), onClose())}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !value.code || !value.label}>
              {pending && <Spinner />}
              Save reason
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
