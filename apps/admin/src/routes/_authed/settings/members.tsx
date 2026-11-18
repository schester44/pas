import { roleLabel } from "@pas/auth/permissions";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Ellipsis, Mail, Plus, Users } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { InviteMemberDialog } from "@/components/invite-member-dialog";
import { RoleOptions } from "@/components/role-options";
import { authClient } from "@/lib/auth";
import { formatDate, initials } from "@/lib/format";
import {
  type Invitation,
  invitationsQuery,
  inviteLink,
  type Member,
  membersQuery,
  organizationKey,
  unwrap,
  useCurrentUserId,
  useOrganizationId,
} from "@/lib/organization";
import { parseRoles, rbacKey, useAccess, useActiveRole } from "@/lib/permissions";

export const Route = createFileRoute("/_authed/settings/members")({
  validateSearch: (search: Record<string, unknown>): { invite?: true } =>
    search.invite === true || search.invite === "true" ? { invite: true } : {},
  component: MembersPage,
});

const rowGrid =
  "grid grid-cols-[minmax(0,1fr)_auto_2rem] items-center gap-x-4 px-(--card-p) md:grid-cols-[minmax(0,1fr)_11rem_7rem_2rem]";

function MembersPage() {
  const access = useAccess();
  const organizationId = useOrganizationId();
  const members = useQuery(membersQuery(organizationId));

  const invitations = useQuery({
    ...invitationsQuery(organizationId),
    enabled: access.members.invite,
  });

  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [removing, setRemoving] = useState<Member | null>(null);
  const inviteOpen = !!search.invite && access.members.invite;

  const setInviteOpen = (next: boolean) =>
    navigate({ search: next ? { invite: true } : {}, replace: true });

  const pending = invitations.data ?? [];

  return (
    <>
      <PageHeader
        title="Members"
        actions={
          access.members.invite && (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <Plus /> Invite member
            </Button>
          )
        }
      />
      <PageBody className="max-w-4xl">
        <Panel flush>
          <div
            className={`${rowGrid} hidden h-10 border-b bg-muted/40 text-xs font-medium text-muted-foreground md:grid`}
          >
            <span>Member</span>
            <span>Role</span>
            <span>Joined</span>
            <span />
          </div>
          {members.error ? (
            <EmptyState
              icon={<Users />}
              title="Couldn't load members"
              description="Refresh the page to try again."
            />
          ) : (
            <ul className="m-0 list-none divide-y p-0">
              {members.isPending &&
                Array.from({ length: 3 }, (_, i) => (
                  <li key={i} className={`${rowGrid} h-15`}>
                    <div className="flex items-center gap-3">
                      <span className="size-8 animate-pulse rounded-full bg-muted" />
                      <span className="grid gap-1.5">
                        <span className="h-3.5 w-32 animate-pulse rounded bg-muted" />
                        <span className="h-3 w-44 animate-pulse rounded bg-muted" />
                      </span>
                    </div>
                  </li>
                ))}
              {members.data?.members.map((member) => (
                <MemberRow key={member.id} member={member} onRemove={() => setRemoving(member)} />
              ))}
            </ul>
          )}
        </Panel>

        {access.members.invite && pending.length > 0 && (
          <Panel title="Pending invitations" flush>
            <ul className="m-0 list-none divide-y p-0">
              {pending.map((invitation) => (
                <InvitationRow key={invitation.id} invitation={invitation} />
              ))}
            </ul>
          </Panel>
        )}
      </PageBody>

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <RemoveMemberDialog member={removing} onClose={() => setRemoving(null)} />
    </>
  );
}

function MemberRow({ member, onRemove }: { member: Member; onRemove: () => void }) {
  const access = useAccess();
  const currentUserId = useCurrentUserId();
  const activeRole = useActiveRole();
  const isSelf = member.userId === currentUserId;
  const isOwner = parseRoles(member.role).includes("owner");
  const actorIsOwner = activeRole ? parseRoles(activeRole).includes("owner") : false;
  // Changing your own role can lock you out; only owners manage other owners.
  const canChangeRole = access.members.update && !isSelf && (!isOwner || actorIsOwner);
  const canRemove = access.members.remove && !isSelf && (!isOwner || actorIsOwner);

  return (
    <li className={`${rowGrid} h-15`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
          {initials(member.user.name || member.user.email)}
        </span>
        <span className="grid min-w-0 leading-tight">
          <span className="truncate text-sm font-medium">
            {member.user.name}
            {isSelf && <span className="font-normal text-muted-foreground"> (you)</span>}
          </span>
          <span className="truncate text-sm text-muted-foreground">{member.user.email}</span>
        </span>
      </div>
      <div className="min-w-0">
        {canChangeRole ? (
          <MemberRoleSelect member={member} allowOwner={actorIsOwner} />
        ) : (
          <span className="block truncate text-sm text-muted-foreground">
            {roleLabel(member.role)}
          </span>
        )}
      </div>
      <span className="hidden text-sm text-muted-foreground tabular-nums md:block">
        {formatDate(member.createdAt)}
      </span>
      <div className="flex justify-end">
        {canRemove && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Member actions">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={onRemove}
                className="text-destructive data-[highlighted]:text-destructive [&_svg]:text-destructive"
              >
                Remove from organization
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  );
}

function MemberRoleSelect({ member, allowOwner }: { member: Member; allowOwner: boolean }) {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  const update = useMutation({
    mutationFn: (role: string) =>
      unwrap(
        authClient.organization.updateMemberRole({ memberId: member.id, role }),
        "Couldn't change the role.",
      ),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: organizationKey(organizationId) });
      await queryClient.invalidateQueries({ queryKey: rbacKey });
    },
  });

  const value = update.isPending ? update.variables : member.role;

  return (
    <div className="grid gap-1">
      <Select value={value} onValueChange={(role) => update.mutate(role)}>
        <SelectTrigger
          size="sm"
          aria-label={`Role for ${member.user.name}`}
          className="-ml-2.5 w-auto max-w-full justify-start border-transparent bg-transparent text-muted-foreground shadow-none hover:bg-muted/60 hover:text-foreground data-[state=open]:bg-muted/60"
        >
          <SelectValue>{roleLabel(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="w-72">
          <RoleOptions allowOwner={allowOwner} current={member.role} />
        </SelectContent>
      </Select>
      {update.error && <p className="m-0 text-xs text-destructive">{update.error.message}</p>}
    </div>
  );
}

function InvitationRow({ invitation }: { invitation: Invitation }) {
  const access = useAccess();
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  const cancel = useMutation({
    mutationFn: () =>
      unwrap(
        authClient.organization.cancelInvitation({ invitationId: invitation.id }),
        "Couldn't cancel the invitation.",
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: organizationKey(organizationId) }),
  });

  return (
    <li className="flex min-h-15 items-center gap-4 px-(--card-p) py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Mail className="size-4" />
      </span>
      <span className="grid min-w-0 flex-1 leading-tight">
        <span className="truncate text-sm font-medium">{invitation.email}</span>
        <span className="truncate text-sm text-muted-foreground">
          {roleLabel(invitation.role)} · Expires{" "}
          <span className="tabular-nums">{formatDate(invitation.expiresAt)}</span>
        </span>
        {cancel.error && (
          <span className="mt-1 text-xs text-destructive">{cancel.error.message}</span>
        )}
      </span>
      <CopyButton value={inviteLink(invitation.id)} label="Copy link" icon={<Copy />} />
      {access.members.cancelInvite && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Invitation actions"
              disabled={cancel.isPending}
            >
              {cancel.isPending ? <Spinner /> : <Ellipsis />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => cancel.mutate()}
              className="text-destructive data-[highlighted]:text-destructive"
            >
              Cancel invitation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

function RemoveMemberDialog({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: (memberId: string) =>
      unwrap(
        authClient.organization.removeMember({ memberIdOrEmail: memberId }),
        "Couldn't remove the member.",
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: organizationKey(organizationId) });
      onClose();
    },
  });

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) {
          remove.reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {member?.user.name}?</DialogTitle>
          <DialogDescription>
            They lose access to this organization right away. You can invite them again later.
          </DialogDescription>
        </DialogHeader>
        {remove.error && <Notice tone="error">{remove.error.message}</Notice>}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => member && remove.mutate(member.id)}
          >
            {remove.isPending && <Spinner />}
            Remove member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
