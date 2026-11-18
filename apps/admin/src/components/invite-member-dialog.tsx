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
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { RoleOptions } from "@/components/role-options";
import { authClient } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { inviteLink, organizationKey, unwrap, useOrganizationId } from "@/lib/organization";
import { parseRoles, useActiveRole } from "@/lib/permissions";

export function InviteMemberDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
  const activeRole = useActiveRole();
  const actorIsOwner = activeRole ? parseRoles(activeRole).includes("owner") : false;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const invite = useMutation({
    mutationFn: () =>
      unwrap(
        authClient.organization.inviteMember({ email: email.trim(), role }),
        "Couldn't create the invite.",
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: organizationKey(organizationId) }),
  });

  function reset() {
    setEmail("");
    setRole("");
    setSubmitted(false);
    invite.reset();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);

    if (!role) return;

    invite.mutate();
  }

  const created = invite.data;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();

        onOpenChange(next);
      }}
    >
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Invite ready</DialogTitle>
              <DialogDescription>
                Send this link to {created.email}. It works until{" "}
                <span className="tabular-nums">{formatDate(created.expiresAt)}</span>.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Input
                readOnly
                aria-label="Invite link"
                value={inviteLink(created.id)}
                className="h-8 font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              <CopyButton value={inviteLink(created.id)} icon={<Copy />} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>
                Invite another
              </Button>
              <DialogClose asChild>
                <Button type="button">Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Invite member</DialogTitle>
              <DialogDescription>They'll join with the role you choose.</DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  placeholder="name@company.com"
                  autoComplete="off"
                  autoFocus
                  required
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="invite-role">Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger id="invite-role" aria-invalid={submitted && !role}>
                    <SelectValue placeholder="Choose a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <RoleOptions allowOwner={actorIsOwner} />
                  </SelectContent>
                </Select>
                {submitted && !role && (
                  <p className="m-0 text-xs text-destructive">Choose a role.</p>
                )}
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
                  Create invite
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
