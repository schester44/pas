import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@pas/ui/components/command";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import {
  ArrowRightLeft,
  FileStack,
  House,
  Inbox,
  Layers,
  LogOut,
  Plus,
  ShieldCheck,
  UserPlus,
  Upload,
  Users,
} from "lucide-react";
import type * as React from "react";
import { useEffect } from "react";
import { authClient } from "@/lib/auth";
import { useAccess } from "@/lib/permissions";
import { useSignOut, useSwitchOrganization } from "@/lib/session";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export const modKey = isMac ? "⌘" : "Ctrl ";

export function useCommandPaletteShortcut(setOpen: React.Dispatch<React.SetStateAction<boolean>>) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        setOpen((open) => !open);
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const access = useAccess();
  const signOut = useSignOut();
  const switchOrganization = useSwitchOrganization();
  const { session } = useRouteContext({ from: "/_authed" });
  const { data: organizations } = authClient.useListOrganizations();

  const otherOrganizations =
    organizations?.filter((org) => org.id !== session.session.activeOrganizationId) ?? [];

  function run(action: () => unknown) {
    onOpenChange(false);
    void action();
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages and actions" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Go to">
          <CommandItem onSelect={() => run(() => navigate({ to: "/" }))}>
            <House /> Overview
          </CommandItem>
          {access.submissions.read && (
            <CommandItem
              keywords={["quotes", "intake", "new business"]}
              onSelect={() => run(() => navigate({ to: "/submissions" }))}
            >
              <Inbox /> Submissions
            </CommandItem>
          )}
          {access.products.read && (
            <CommandItem onSelect={() => run(() => navigate({ to: "/products" }))}>
              <Layers /> Products
            </CommandItem>
          )}
          {access.documents.read && (
            <CommandItem
              keywords={["policy forms", "editions", "endorsements", "documents", "pdf"]}
              onSelect={() => run(() => navigate({ to: "/documents/forms" }))}
            >
              <FileStack /> Forms library
            </CommandItem>
          )}
          {access.members.view && (
            <CommandItem
              keywords={["team", "people", "settings"]}
              onSelect={() => run(() => navigate({ to: "/settings/members" }))}
            >
              <Users /> Members
            </CommandItem>
          )}
          {access.roles.view && (
            <CommandItem
              keywords={["permissions", "rbac", "access", "settings"]}
              onSelect={() => run(() => navigate({ to: "/settings/roles" }))}
            >
              <ShieldCheck /> Roles
            </CommandItem>
          )}
        </CommandGroup>
        {(access.products.write ||
          access.documents.write ||
          access.members.invite ||
          access.roles.create) && (
          <CommandGroup heading="Actions">
            {access.products.write && (
              <CommandItem
                keywords={["create"]}
                onSelect={() => run(() => navigate({ to: "/products", search: { new: true } }))}
              >
                <Plus /> New product
              </CommandItem>
            )}
            {access.documents.write && (
              <CommandItem
                keywords={["policy form", "edition", "pdf", "forms library"]}
                onSelect={() =>
                  run(() => navigate({ to: "/documents/forms", search: { upload: true } }))
                }
              >
                <Upload /> Upload form
              </CommandItem>
            )}
            {access.members.invite && (
              <CommandItem
                keywords={["add", "team"]}
                onSelect={() =>
                  run(() => navigate({ to: "/settings/members", search: { invite: true } }))
                }
              >
                <UserPlus /> Invite member
              </CommandItem>
            )}
            {access.roles.create && (
              <CommandItem
                keywords={["create", "permissions"]}
                onSelect={() => run(() => navigate({ to: "/settings/roles/new" }))}
              >
                <Plus /> New role
              </CommandItem>
            )}
          </CommandGroup>
        )}
        {otherOrganizations.length > 0 && (
          <CommandGroup heading="Switch organization">
            {otherOrganizations.map((org) => (
              <CommandItem
                key={org.id}
                value={`switch-${org.id}`}
                keywords={["switch", "organization", org.name]}
                onSelect={() => run(() => switchOrganization(org.id))}
              >
                <ArrowRightLeft /> {org.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Account">
          <CommandItem keywords={["logout", "log out"]} onSelect={() => run(signOut)}>
            <LogOut /> Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
