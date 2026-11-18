import { builtInRoleLabels, isBuiltInRole, roleKey, roleLabel } from "@pas/auth/permissions";
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
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { PermissionMatrix, type RoleStatements } from "@/components/permission-matrix";
import { authClient } from "@/lib/auth";
import { organizationKey, unwrap, useOrganizationId } from "@/lib/organization";
import { rbacKey, useAccess } from "@/lib/permissions";

export function RoleHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return (
    <PageHeader
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <Link to="/settings/roles" className="text-muted-foreground hover:text-foreground">
            Roles
          </Link>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{title}</span>
        </span>
      }
      actions={actions}
    />
  );
}

export function BuiltInRoleView({
  role,
  statements,
}: {
  role: string;
  statements: RoleStatements;
}) {
  const description = isBuiltInRole(role) ? builtInRoleLabels[role].description : undefined;

  return (
    <>
      <RoleHeader title={roleLabel(role)} />
      <PageBody className="max-w-4xl">
        <Panel title="Permissions" description={description} flush>
          <PermissionMatrix value={statements} />
        </Panel>
      </PageBody>
    </>
  );
}

function useInvalidateRoles() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();

  return async () => {
    await queryClient.invalidateQueries({ queryKey: organizationKey(organizationId) });
    await queryClient.invalidateQueries({ queryKey: rbacKey });
  };
}

export function RoleEditor({
  existing,
}: {
  existing?: { role: string; permission: RoleStatements };
}) {
  const access = useAccess();
  const navigate = useNavigate();
  const invalidate = useInvalidateRoles();
  const [name, setName] = useState("");
  const [permission, setPermission] = useState<RoleStatements>(existing?.permission ?? {});
  const [deleting, setDeleting] = useState(false);
  const canSave = existing ? access.roles.update : access.roles.create;

  const save = useMutation({
    mutationFn: () =>
      existing
        ? unwrap(
            authClient.organization.updateRole({ roleName: existing.role, data: { permission } }),
            "Couldn't save the role.",
          )
        : unwrap(
            authClient.organization.createRole({ role: roleKey(name), permission }),
            "Couldn't create the role.",
          ),
    onSuccess: async () => {
      await invalidate();
      await navigate({ to: "/settings/roles" });
    },
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  const title = existing ? roleLabel(existing.role) : "New role";

  return (
    <>
      <RoleHeader
        title={title}
        actions={
          existing &&
          access.roles.delete && (
            <Button variant="outline" size="sm" onClick={() => setDeleting(true)}>
              Delete role
            </Button>
          )
        }
      />
      <form onSubmit={onSubmit} className="contents">
        <PageBody className="max-w-4xl">
          {!existing && (
            <Panel title="Details">
              <div className="grid max-w-sm gap-2">
                <Label htmlFor="role-name">Name</Label>
                <Input
                  id="role-name"
                  value={name}
                  placeholder="Claims lead"
                  autoFocus
                  required
                  onChange={(event) => setName(event.target.value)}
                />
                <p className="m-0 text-xs text-muted-foreground">Can't be changed later.</p>
              </div>
            </Panel>
          )}
          <Panel
            title="Permissions"
            description="You can only grant permissions your own role has."
            flush
            footer={
              canSave && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                  {save.error && (
                    <Notice tone="error" className="sm:mr-auto">
                      {save.error.message}
                    </Notice>
                  )}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" asChild>
                      <Link to="/settings/roles">Cancel</Link>
                    </Button>
                    <Button
                      type="submit"
                      disabled={save.isPending || (!existing && !roleKey(name))}
                    >
                      {save.isPending && <Spinner />}
                      {existing ? "Save changes" : "Create role"}
                    </Button>
                  </div>
                </div>
              )
            }
          >
            <PermissionMatrix value={permission} onChange={canSave ? setPermission : undefined} />
          </Panel>
        </PageBody>
      </form>
      {existing && (
        <DeleteRoleDialog role={existing.role} open={deleting} onOpenChange={setDeleting} />
      )}
    </>
  );
}

function DeleteRoleDialog({
  role,
  open,
  onOpenChange,
}: {
  role: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const invalidate = useInvalidateRoles();

  const remove = useMutation({
    mutationFn: () =>
      unwrap(authClient.organization.deleteRole({ roleName: role }), "Couldn't delete the role."),
    onSuccess: async () => {
      await invalidate();
      await navigate({ to: "/settings/roles" });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) remove.reset();

        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {roleLabel(role)}?</DialogTitle>
          <DialogDescription>
            Roles that are still assigned can't be deleted. Move those members to another role
            first.
          </DialogDescription>
        </DialogHeader>
        {remove.error && <Notice tone="error">{remove.error.message}</Notice>}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending && <Spinner />}
            Delete role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
