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
import { Label } from "@pas/ui/components/label";
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
import { jurisdictionName, subdivisionsOf } from "@pas/ui/lib/jurisdictions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, Plus } from "lucide-react";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/settings/licensees")({
  component: LicenseesPage,
});

interface Draft {
  id?: string;
  name: string;
  licenseNumber: string;
  jurisdiction: string;
  active: boolean;
}

const stateName = (code: string) =>
  jurisdictionName({ country: code.slice(0, 2), subdivision: code });

function LicenseesPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const licensees = useQuery(trpc.compliance.licensees.list.queryOptions());
  const [editing, setEditing] = useState<Draft | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.compliance.licensees.pathKey() });

  return (
    <>
      <PageHeader
        title="Surplus lines licensees"
        actions={
          <Button
            onClick={() =>
              setEditing({ name: "", licenseNumber: "", jurisdiction: "", active: true })
            }
          >
            <Plus /> Add licensee
          </Button>
        }
      />
      <PageBody className="max-w-4xl">
        <Panel
          title="Licensees of record"
          description="Surplus lines filings and tax remittances for a home state are made under the licensee listed for it."
          flush
        >
          {licensees.data?.length === 0 ? (
            <EmptyState
              icon={<BadgeCheck />}
              title="No licensees yet"
              description="Add the licensee who files for each state."
            />
          ) : (
            <ul className="m-0 list-none divide-y p-0">
              {licensees.data?.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => setEditing(l)}
                    className="flex w-full items-center justify-between gap-3 px-(--card-p) py-3.5 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                  >
                    <span className="grid gap-0.5">
                      <span className="text-sm leading-5 font-medium">{l.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {stateName(l.jurisdiction)} · license {l.licenseNumber}
                      </span>
                    </span>
                    {!l.active && <span className="text-xs text-muted-foreground">Inactive</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PageBody>
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          {editing && (
            <LicenseeForm draft={editing} onDone={() => refresh().then(() => setEditing(null))} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function LicenseeForm({ draft: initial, onDone }: { draft: Draft; onDone: () => void }) {
  const trpc = useTRPC();
  const [draft, setDraft] = useState(initial);
  const save = useMutation(trpc.compliance.licensees.save.mutationOptions({ onSuccess: onDone }));

  const remove = useMutation(
    trpc.compliance.licensees.remove.mutationOptions({ onSuccess: onDone }),
  );

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(draft);
      }}
    >
      <DialogHeader>
        <DialogTitle>{initial.id ? initial.name : "Add licensee"}</DialogTitle>
        <DialogDescription>The surplus lines license filings are made under.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="licensee-name">Licensee</Label>
          <Input
            id="licensee-name"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="licensee-state">State</Label>
            <Select
              value={draft.jurisdiction}
              onValueChange={(jurisdiction) => set({ jurisdiction })}
            >
              <SelectTrigger id="licensee-state">
                <SelectValue placeholder="Choose a state" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {subdivisionsOf("US").map(([code, name]) => (
                  <SelectItem key={code} value={code}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="licensee-number">License number</Label>
            <Input
              id="licensee-number"
              value={draft.licenseNumber}
              className="tabular-nums"
              onChange={(e) => set({ licenseNumber: e.target.value })}
            />
          </div>
        </div>
      </div>
      {(save.error ?? remove.error) && (
        <Notice tone="error" title="Couldn't save">
          {(save.error ?? remove.error)?.message}
        </Notice>
      )}
      <DialogFooter className="sm:justify-between">
        {initial.id ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => remove.mutate({ id: initial.id! })}
          >
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Spinner />}
            Save licensee
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
