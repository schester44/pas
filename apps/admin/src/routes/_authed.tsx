import { Brand } from "@pas/ui/components/brand";
import { AppShell, NavSection, navItemClassName } from "@pas/ui/components/app-shell";
import { Kbd } from "@pas/ui/components/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { createFileRoute, Link, Outlet, redirect, useRouter } from "@tanstack/react-router";
import {
  Building2,
  Check,
  ChevronsUpDown,
  FileStack,
  House,
  Inbox,
  Layers,
  LogOut,
  Plus,
  ScrollText,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { useState } from "react";
import { CommandPalette, modKey, useCommandPaletteShortcut } from "@/components/command-palette";
import { authClient } from "@/lib/auth";
import { initials } from "@/lib/format";
import { prefetchAccess, useAccess } from "@/lib/permissions";
import { useSignOut, useSwitchOrganization } from "@/lib/session";
import { queryClient } from "@/lib/trpc";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    const session = await resolveSession();
    const organizationId = session.session.activeOrganizationId;

    if (organizationId) await prefetchAccess(queryClient, organizationId);

    return { session };
  },
  component: AuthedLayout,
});

async function resolveSession() {
  const { data } = await authClient.getSession();

  if (!data) throw redirect({ to: "/login" });

  if (data.session.activeOrganizationId) return data;

  // One organization: just use it. Otherwise let the user choose.
  const { data: organizations } = await authClient.organization.list();
  const only = organizations?.length === 1 ? organizations[0] : undefined;

  if (!only) throw redirect({ to: "/organizations" });

  await authClient.organization.setActive({ organizationId: only.id });
  const refreshed = await authClient.getSession({ query: { disableCookieCache: true } });

  if (!refreshed.data) throw redirect({ to: "/login" });

  return refreshed.data;
}

function AuthedLayout() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  useCommandPaletteShortcut(setPaletteOpen);

  return (
    <AppShell
      sidebar={<Sidebar onOpenPalette={() => setPaletteOpen(true)} />}
      mobileTitle={<Brand />}
    >
      <Outlet />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </AppShell>
  );
}

function Sidebar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const access = useAccess();

  const isPlatformAdmin = Route.useRouteContext().session.user.role === "admin";

  return (
    <>
      <div className="grid gap-2">
        <OrganizationSwitcher />
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground transition-colors outline-none hover:bg-black/[0.03] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Search aria-hidden className="size-4 shrink-0" />
          <span className="flex-1 text-left">Search</span>
          <Kbd>{modKey}K</Kbd>
        </button>
      </div>
      <div className="grid gap-6">
        <NavSection>
          <Link to="/" className={navItemClassName} activeOptions={{ exact: true }}>
            <House /> Overview
          </Link>
        </NavSection>
        {(access.submissions.read || access.policies.read) && (
          <NavSection label="Operate">
            {access.submissions.read && (
              <Link to="/submissions" className={navItemClassName}>
                <Inbox /> Submissions
              </Link>
            )}
            {access.policies.read && (
              <Link to="/policies" className={navItemClassName}>
                <ScrollText /> Policies
              </Link>
            )}
            {access.policies.read && (
              <Link to="/clients" className={navItemClassName}>
                <Users /> Clients
              </Link>
            )}
          </NavSection>
        )}
        {(access.products.read || access.documents.read) && (
          <NavSection label="Configure">
            {access.products.read && (
              <Link to="/products" className={navItemClassName}>
                <Layers /> Products
              </Link>
            )}
            {access.documents.read && (
              <Link to="/documents/forms" className={navItemClassName}>
                <FileStack /> Forms library
              </Link>
            )}
          </NavSection>
        )}
      </div>
      <div className="mt-auto grid gap-2">
        {isPlatformAdmin && (
          <NavSection>
            <Link to="/platform/tenants" className={navItemClassName}>
              <Building2 /> Platform
            </Link>
          </NavSection>
        )}
        {access.settings && (
          <NavSection>
            <Link to="/settings" className={navItemClassName}>
              <Settings /> Settings
            </Link>
          </NavSection>
        )}
        <UserMenu />
      </div>
    </>
  );
}

function OrganizationSwitcher() {
  const router = useRouter();
  const switchTo = useSwitchOrganization();
  const { session } = Route.useRouteContext();
  const { data: organizations } = authClient.useListOrganizations();
  const active = organizations?.find((org) => org.id === session.session.activeOrganizationId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors outline-none hover:bg-black/[0.03] focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
          {(active?.name ?? "·").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {active?.name ?? "Organization"}
        </span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations?.map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => switchTo(org.id)}>
            <span className="min-w-0 flex-1 truncate">{org.name}</span>
            {org.id === active?.id && <Check className="text-primary!" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.navigate({ to: "/organizations" })}>
          <Plus /> New organization
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu() {
  const signOut = useSignOut();
  const { session } = Route.useRouteContext();
  const { user } = session;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors outline-none hover:bg-black/[0.03] focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
          {initials(user.name)}
        </span>
        <span className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-sm font-medium">{user.name}</span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuItem onSelect={signOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
