import { AppShell, NavSection, navItemClassName } from "@pas/ui/components/app-shell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { createFileRoute, Link, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { Check, ChevronsUpDown, House, Layers, LogOut, Plus } from "lucide-react";
import { authClient } from "@/lib/auth";
import { initials } from "@/lib/format";
import { queryClient } from "@/lib/trpc";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data) throw redirect({ to: "/login" });
    if (!data.session.activeOrganizationId) {
      // One organization: just use it. Otherwise let the user choose.
      const { data: organizations } = await authClient.organization.list();
      const only = organizations?.length === 1 ? organizations[0] : undefined;
      if (!only) throw redirect({ to: "/organizations" });
      await authClient.organization.setActive({ organizationId: only.id });
      const refreshed = await authClient.getSession({ query: { disableCookieCache: true } });
      if (!refreshed.data) throw redirect({ to: "/login" });
      return { session: refreshed.data };
    }
    return { session: data };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <AppShell sidebar={<Sidebar />}>
      <Outlet />
    </AppShell>
  );
}

function Sidebar() {
  return (
    <>
      <OrganizationSwitcher />
      <div className="grid gap-6">
        <NavSection>
          <Link to="/" className={navItemClassName} activeOptions={{ exact: true }}>
            <House /> Overview
          </Link>
        </NavSection>
        <NavSection label="Configure">
          <Link to="/products" className={navItemClassName}>
            <Layers /> Products
          </Link>
        </NavSection>
      </div>
      <div className="mt-auto">
        <UserMenu />
      </div>
    </>
  );
}

function OrganizationSwitcher() {
  const router = useRouter();
  const { session } = Route.useRouteContext();
  const { data: organizations } = authClient.useListOrganizations();
  const active = organizations?.find((org) => org.id === session.session.activeOrganizationId);

  async function switchTo(organizationId: string) {
    await authClient.organization.setActive({ organizationId });
    queryClient.clear();
    await router.invalidate();
  }

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
  const router = useRouter();
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
        <DropdownMenuItem
          onSelect={async () => {
            await authClient.signOut();
            queryClient.clear();
            await router.navigate({ to: "/login" });
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
