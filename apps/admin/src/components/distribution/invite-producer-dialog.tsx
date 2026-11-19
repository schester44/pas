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
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { formatDate } from "@/lib/format";
import { inviteLink } from "@/lib/organization";
import { useTRPC } from "@/lib/trpc";
import { Field } from "./agency-dialog";

const EMPTY = {
  name: "",
  email: "",
  npn: "",
  producerNumber: "",
  role: "producer" as "producer" | "admin",
};

/** Adds a producer to an agency: links an existing member, or creates a tenant invitation. */
export function InviteProducerDialog({
  agency,
  open,
  onOpenChange,
}: {
  agency: { id: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const set = (patch: Partial<typeof EMPTY>) => setDraft((d) => ({ ...d, ...patch }));

  const invite = useMutation(
    trpc.distribution.producers.invite.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.distribution.pathKey() }),
    }),
  );

  function reset() {
    setDraft(EMPTY);
    setSubmitted(false);
    invite.reset();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);

    if (!draft.email.includes("@")) return;

    invite.mutate({
      agencyId: agency.id,
      name: draft.name,
      email: draft.email.trim(),
      role: draft.role,
      npn: draft.npn || null,
      producerNumber: draft.producerNumber || null,
    });
  }

  const done = invite.data;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();

        onOpenChange(next);
      }}
    >
      <DialogContent>
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>{done.invitation ? "Invite ready" : "Producer added"}</DialogTitle>
              <DialogDescription>
                {done.invitation ? (
                  <>
                    Send this link to {done.producer.email}. It works until{" "}
                    <span className="tabular-nums">{formatDate(done.invitation.expiresAt)}</span>,
                    and they join {agency.name} when they accept.
                  </>
                ) : (
                  `${done.producer.name} already has a login and is now a producer at ${agency.name}.`
                )}
              </DialogDescription>
            </DialogHeader>
            {done.invitation && (
              <div className="flex gap-2">
                <Input
                  readOnly
                  aria-label="Invite link"
                  value={inviteLink(done.invitation.id)}
                  className="h-8 font-mono text-xs"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <CopyButton value={inviteLink(done.invitation.id)} icon={<Copy />} />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>
                Add another
              </Button>
              <DialogClose asChild>
                <Button type="button">Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Invite producer</DialogTitle>
              <DialogDescription>They'll sell for {agency.name}.</DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Email"
                  id="producer-email"
                  error={submitted && !draft.email.includes("@") ? "Enter an email address." : null}
                >
                  <Input
                    id="producer-email"
                    type="email"
                    autoFocus
                    autoComplete="off"
                    placeholder="name@agency.com"
                    value={draft.email}
                    onChange={(e) => set({ email: e.target.value })}
                  />
                </Field>
                <Field label="Name" id="producer-name" optional>
                  <Input
                    id="producer-name"
                    value={draft.name}
                    onChange={(e) => set({ name: e.target.value })}
                  />
                </Field>
                <Field label="NPN" id="producer-npn" optional>
                  <Input
                    id="producer-npn"
                    inputMode="numeric"
                    value={draft.npn}
                    onChange={(e) => set({ npn: e.target.value.replace(/\D/g, "") })}
                  />
                </Field>
                <Field label="Producer number" id="producer-number" optional>
                  <Input
                    id="producer-number"
                    value={draft.producerNumber}
                    onChange={(e) => set({ producerNumber: e.target.value })}
                  />
                </Field>
              </div>
              <div className="grid gap-2">
                <span className="text-sm font-medium">Role</span>
                <SegmentedControl
                  label="Role"
                  value={draft.role}
                  onValueChange={(role) => set({ role })}
                  options={[
                    { value: "producer", label: "Agent" },
                    { value: "admin", label: "Agency admin" },
                  ]}
                />
              </div>
              {invite.error && <Notice tone="error">{invite.error.message}</Notice>}
              <DialogFooter className="pt-2">
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={invite.isPending}>
                  {invite.isPending && <Spinner />}
                  Invite producer
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
