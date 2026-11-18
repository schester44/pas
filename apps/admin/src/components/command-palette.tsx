import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@pas/ui/components/command";
import {
  modKey,
  paletteFilter,
  RecentGroups,
  SearchEmpty,
  type SearchResult,
  SearchResultGroups,
  useDebouncedValue,
  usePaletteShortcuts,
  useRecentSearches,
} from "@pas/ui/components/global-search";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
import { useState } from "react";
import { authClient } from "@/lib/auth";
import { useAccess } from "@/lib/permissions";
import { useSignOut, useSwitchOrganization } from "@/lib/session";
import { useTRPC } from "@/lib/trpc";

export { modKey, usePaletteShortcuts as useCommandPaletteShortcut };

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

  const trpc = useTRPC();
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim(), 120);
  const { recent, remember } = useRecentSearches(`pas.admin.search.${session.user.id}`);

  const results = useQuery({
    ...trpc.search.query.queryOptions({ q: query }),
    enabled: open && query.length > 0,
    placeholderData: keepPreviousData,
  });

  const searching = search.trim() !== query || results.isFetching;

  function changeOpen(next: boolean) {
    if (!next) setSearch("");

    onOpenChange(next);
  }

  function run(action: () => unknown) {
    changeOpen(false);
    void action();
  }

  function openResult(result: SearchResult) {
    remember(result, search);

    run(() => {
      switch (result.type) {
        case "policy":
        case "invoice":
          return navigate({
            to: "/policies/$policyId",
            params: { policyId: result.policyId ?? result.id },
          });
        case "submission":
          return navigate({
            to: "/submissions/$submissionId",
            params: { submissionId: result.id },
          });
        case "client":
          return result.policyId
            ? navigate({ to: "/policies/$policyId", params: { policyId: result.policyId } })
            : navigate({ to: "/clients" });
        case "product":
          return navigate({ to: "/products/$productId", params: { productId: result.id } });
        case "member":
          return navigate({ to: "/settings/members" });
      }
    });
  }

  return (
    <CommandDialog open={open} onOpenChange={changeOpen} commandProps={{ filter: paletteFilter }}>
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search policies, clients, submissions or pages"
      />
      <CommandList>
        <CommandEmpty>
          <SearchEmpty query={search.trim()} searching={searching} />
        </CommandEmpty>
        {search.trim() ? (
          <SearchResultGroups results={results.data ?? []} keyword={search} onSelect={openResult} />
        ) : (
          <RecentGroups recent={recent} onSelectResult={openResult} onSelectQuery={setSearch} />
        )}
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
