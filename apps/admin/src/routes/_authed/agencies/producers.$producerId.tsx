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
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import { subdivisionsOf } from "@pas/ui/lib/jurisdictions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, Plus } from "lucide-react";
import { useState } from "react";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import { Field } from "@/components/distribution/agency-dialog";
import {
  expiryLabel,
  Fact,
  LicenseHealth,
  type ProducerDetail,
  ProducerStatus,
  stateName,
} from "@/components/distribution/format";
import { formatPlainDate } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/agencies/producers/$producerId")({
  component: ProducerPage,
});

function ProducerPage() {
  const { producerId } = Route.useParams();
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();
  const producer = useQuery(trpc.distribution.producers.get.queryOptions({ id: producerId }));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);

  const primary =
    producer.data?.memberships.find((m) => m.primary) ?? producer.data?.memberships[0];

  const remove = useMutation(
    trpc.distribution.producers.removeLicense.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.distribution.pathKey() }),
    }),
  );

  return (
    <>
      <PageHeader
        title={
          <Breadcrumb
            parents={[
              <Link key="agencies" to="/agencies">
                Agencies
              </Link>,
              ...(primary
                ? [
                    <Link
                      key="agency"
                      to="/agencies/$agencyId"
                      params={{ agencyId: primary.agencyId }}
                    >
                      {primary.agencyName}
                    </Link>,
                  ]
                : []),
            ]}
            current={producer.data?.name}
          />
        }
        actions={
          access.agencies.write &&
          producer.data && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      />
      <PageBody className="max-w-4xl">
        {producer.error ? (
          <Notice tone="error" title="Couldn't load this producer">
            {producer.error.message}
          </Notice>
        ) : !producer.data ? (
          <div className="h-60 animate-pulse rounded-xl bg-muted/60" />
        ) : (
          <>
            <Panel title="Producer" action={<ProducerStatus status={producer.data.status} />}>
              <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                <Fact label="Email">{producer.data.email}</Fact>
                <Fact label="NPN">
                  <span className="tabular-nums">{producer.data.npn ?? "—"}</span>
                </Fact>
                <Fact label="Producer number">{producer.data.producerNumber ?? "—"}</Fact>
                <Fact label="Agencies">
                  {producer.data.memberships
                    .map((m) => `${m.agencyName}${m.role === "admin" ? " (admin)" : ""}`)
                    .join(", ") || "—"}
                </Fact>
                <Fact label="Login">{producer.data.userId ? "Joined" : "Invitation pending"}</Fact>
              </dl>
            </Panel>
            <Panel
              flush
              title="Licenses"
              description="Checked at quote and bind for the risk state and effective date."
              action={
                access.agencies.write && (
                  <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                    <Plus /> Add license
                  </Button>
                )
              }
            >
              {producer.data.licenses.length === 0 ? (
                <EmptyState
                  icon={<BadgeCheck />}
                  title="No licenses on file"
                  description="Binds are blocked where a product requires a license."
                />
              ) : (
                <ul className="m-0 list-none divide-y p-0">
                  {producer.data.licenses.map((license) => (
                    <li
                      key={license.id}
                      className="flex items-center justify-between gap-4 px-(--card-p) py-3.5"
                    >
                      <span className="grid min-w-0 gap-0.5">
                        <span className="text-sm leading-5 font-medium">
                          {stateName(license)}{" "}
                          <span className="font-normal text-muted-foreground tabular-nums">
                            · {license.licenseNumber}
                          </span>
                        </span>
                        <span className="truncate text-xs text-muted-foreground tabular-nums">
                          {license.linesOfAuthority.join(", ")} ·{" "}
                          {formatPlainDate(license.effectiveDate)} – {expiryLabel(license)}
                          {license.source === "nipr" && " · NIPR"}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <LicenseHealth health={license.health} />
                        {access.agencies.write && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate({ producerId, licenseId: license.id })}
                          >
                            Remove
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            {producer.data.appointments.length > 0 && (
              <Panel title="Appointments" flush>
                <ul className="m-0 list-none divide-y p-0">
                  {producer.data.appointments.map((a) => (
                    <li key={a.id} className="flex justify-between px-(--card-p) py-3 text-sm">
                      <span className="font-medium">{a.carrier}</span>
                      <span className="text-muted-foreground">{stateName(a)}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            <LicenseDialog producer={producer.data} open={adding} onOpenChange={setAdding} />
            <EditProducerDialog producer={producer.data} open={editing} onOpenChange={setEditing} />
          </>
        )}
      </PageBody>
    </>
  );
}

function LicenseDialog({
  producer,
  open,
  onOpenChange,
}: {
  producer: ProducerDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const empty = {
    subdivision: "",
    licenseNumber: "",
    lines: "Property, Casualty",
    effectiveDate: "",
    expirationDate: "",
  };

  const [draft, setDraft] = useState(empty);
  const set = (patch: Partial<typeof empty>) => setDraft((d) => ({ ...d, ...patch }));

  const save = useMutation(
    trpc.distribution.producers.saveLicense.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.distribution.pathKey() });
        onOpenChange(false);
      },
    }),
  );

  const ready =
    draft.subdivision && draft.licenseNumber.trim() && draft.effectiveDate && draft.lines.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(empty);

        save.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add license</DialogTitle>
          <DialogDescription>
            {producer.npn ? `For NPN ${producer.npn}.` : "Add the producer's NPN first."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();

            if (!ready) return;

            save.mutate({
              producerId: producer.id,
              country: "US",
              subdivision: draft.subdivision,
              licenseNumber: draft.licenseNumber,
              linesOfAuthority: draft.lines
                .split(",")
                .map((l) => l.trim())
                .filter(Boolean),
              effectiveDate: draft.effectiveDate,
              expirationDate: draft.expirationDate || null,
              status: "active",
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="State" id="license-state">
              <Select
                value={draft.subdivision}
                onValueChange={(subdivision) => set({ subdivision })}
              >
                <SelectTrigger id="license-state">
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  {subdivisionsOf("US").map(([code, name]) => (
                    <SelectItem key={code} value={code}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="License number" id="license-number">
              <Input
                id="license-number"
                value={draft.licenseNumber}
                onChange={(e) => set({ licenseNumber: e.target.value })}
              />
            </Field>
            <Field label="Effective" id="license-effective">
              <Input
                id="license-effective"
                type="date"
                value={draft.effectiveDate}
                onChange={(e) => set({ effectiveDate: e.target.value })}
              />
            </Field>
            <Field label="Expires" id="license-expires" optional>
              <Input
                id="license-expires"
                type="date"
                value={draft.expirationDate}
                onChange={(e) => set({ expirationDate: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Lines of authority" id="license-lines">
            <Input
              id="license-lines"
              value={draft.lines}
              onChange={(e) => set({ lines: e.target.value })}
            />
          </Field>
          {save.error && <Notice tone="error">{save.error.message}</Notice>}
          <DialogFooter className="pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!ready || save.isPending || !producer.npn}>
              {save.isPending && <Spinner />}
              Add license
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditProducerDialog({
  producer,
  open,
  onOpenChange,
}: {
  producer: ProducerDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const initial = {
    name: producer.name,
    npn: producer.npn ?? "",
    producerNumber: producer.producerNumber ?? "",
  };

  const [draft, setDraft] = useState(initial);

  const save = useMutation(
    trpc.distribution.producers.save.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.distribution.pathKey() });
        onOpenChange(false);
      },
    }),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(initial);

        save.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit producer</DialogTitle>
          <DialogDescription>{producer.email}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();

            save.mutate({
              id: producer.id,
              name: draft.name,
              npn: draft.npn || null,
              producerNumber: draft.producerNumber || null,
              status: producer.status,
              memberships: producer.memberships.map(({ agencyId, role, primary }) => ({
                agencyId,
                role,
                primary,
              })),
            });
          }}
        >
          <Field label="Name" id="edit-name">
            <Input
              id="edit-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="NPN" id="edit-npn" optional>
              <Input
                id="edit-npn"
                inputMode="numeric"
                value={draft.npn}
                onChange={(e) => setDraft({ ...draft, npn: e.target.value.replace(/\D/g, "") })}
              />
            </Field>
            <Field label="Producer number" id="edit-number" optional>
              <Input
                id="edit-number"
                value={draft.producerNumber}
                onChange={(e) => setDraft({ ...draft, producerNumber: e.target.value })}
              />
            </Field>
          </div>
          {save.error && <Notice tone="error">{save.error.message}</Notice>}
          <DialogFooter className="pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!draft.name.trim() || save.isPending}>
              {save.isPending && <Spinner />}
              Save producer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
