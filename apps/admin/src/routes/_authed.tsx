import { loadSession } from "@pas/auth/client";
import { Brand } from "@pas/ui/components/brand";
import { AppShell, NavSection, navItemClassName } from "@pas/ui/components/app-shell";
import { Kbd } from "@pas/ui/components/command";
import { SandboxBanner } from "@pas/ui/components/sandbox-banner";
import { StatusChip } from "@pas/ui/components/status-chip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import {
  BadgeCheck,
  Banknote,
  BookOpen,
  Building,
  Building2,
  ChartColumn,
  Check,
  ChevronsUpDown,
  ClipboardCheck,
  FileStack,
  FolderDown,
  HandCoins,
  House,
  Inbox,
  Landmark,
  Layers,
  LogOut,
  Percent,
  Plus,
  Puzzle,
  ReceiptText,
  Scale,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Store,
  Users,
} from "lucide-react";
import { useState } from "react";
import { CommandPalette, modKey, useCommandPaletteShortcut } from "@/components/command-palette";
import { NotificationsBell } from "@/components/notifications-bell";
import { authClient } from "@/lib/auth";
import { isSandboxOrganization, useEnvironment } from "@/lib/environment";
import { formatDateTime, initials } from "@/lib/format";
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
  const data = await loadSession(authClient);

  if (!data) throw redirect({ to: "/login" });

  if (data.session.activeOrganizationId) return data;

  // One organization: just use it. Otherwise let the user choose.
  const { data: organizations } = await authClient.organization.list();
  const only = organizations?.length === 1 ? organizations[0] : undefined;

  if (!only) throw redirect({ to: "/organizations" });

  await authClient.organization.setActive({ organizationId: only.id });
  const refreshed = await loadSession(authClient, { disableCookieCache: true });

  if (!refreshed) throw redirect({ to: "/login" });

  return refreshed;
}

function AuthedLayout() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  useCommandPaletteShortcut(setPaletteOpen);
  const environment = useEnvironment();

  return (
    <AppShell
      banner={
        environment.data?.kind === "sandbox" && <EnvironmentBanner now={environment.data.now} />
      }
      sidebar={<Sidebar onOpenPalette={() => setPaletteOpen(true)} />}
      mobileTitle={<Brand />}
    >
      <Outlet />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </AppShell>
  );
}

function EnvironmentBanner({ now }: { now: string }) {
  const { session } = Route.useRouteContext();
  const { data: organizations } = authClient.useListOrganizations();
  const active = organizations?.find((org) => org.id === session.session.activeOrganizationId);

  return (
    <SandboxBanner
      name={active?.name}
      time={`Sandbox time ${formatDateTime(now)}`}
      action={
        <Link to="/settings/sandbox" className="font-medium underline-offset-2 hover:underline">
          Advance time
        </Link>
      }
    />
  );
}

function Sidebar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const access = useAccess();

  const isPlatformAdmin = Route.useRouteContext().session.user.role === "admin";
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  const within = (...prefixes: string[]) =>
    prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

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
        <NotificationsBell />
      </div>
      <div className="-mx-3 grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-3">
        <NavSection>
          <Link to="/" className={navItemClassName} activeOptions={{ exact: true }}>
            <House /> Overview
          </Link>
        </NavSection>
        {(access.submissions.read || access.policies.read) && (
          <NavSection
            label="Operate"
            collapsible
            active={within("/submissions", "/underwriting", "/policies", "/clients", "/compliance")}
          >
            {access.submissions.read && (
              <Link to="/submissions" className={navItemClassName}>
                <Inbox /> Submissions
              </Link>
            )}
            {access.underwriting.read && (
              <Link to="/underwriting" className={navItemClassName}>
                <ClipboardCheck /> Underwriting
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
            {access.compliance.read && (
              <Link to="/compliance" className={navItemClassName}>
                <ShieldCheck /> Compliance
              </Link>
            )}
          </NavSection>
        )}
        {access.billing.read && (
          <NavSection label="Billing" collapsible active={within("/billing")}>
            <Link to="/billing/payments" className={navItemClassName}>
              <Banknote /> Payments
            </Link>
            <Link to="/billing/apply" className={navItemClassName}>
              <HandCoins /> Cash application
            </Link>
            <Link to="/billing/ledger" className={navItemClassName}>
              <BookOpen /> Ledger
            </Link>
            <Link to="/billing/reports" className={navItemClassName}>
              <ChartColumn /> Reports
            </Link>
            <Link to="/billing/reconciliation" className={navItemClassName}>
              <Scale /> Reconciliation
            </Link>
            <Link to="/billing/statements" className={navItemClassName}>
              <ReceiptText /> Agency statements
            </Link>
          </NavSection>
        )}
        {access.agencies.read && (
          <NavSection
            label="Distribution"
            collapsible
            active={within("/agencies", "/distribution")}
          >
            <Link to="/agencies" className={navItemClassName}>
              <Building /> Agencies
            </Link>
            {access.agencies.write && access.products.read && (
              <>
                <Link to="/distribution/licensing" className={navItemClassName}>
                  <BadgeCheck /> Licensing
                </Link>
                <Link to="/distribution/commissions" className={navItemClassName}>
                  <Percent /> Commissions
                </Link>
                <Link to="/distribution/downloads" className={navItemClassName}>
                  <FolderDown /> Downloads
                </Link>
              </>
            )}
          </NavSection>
        )}
        {(access.products.read || access.documents.read || access.extensions.read) && (
          <NavSection
            label="Configure"
            collapsible
            active={within("/offerings", "/products", "/carriers", "/documents", "/extensions")}
          >
            {access.products.read && (
              <Link to="/offerings" className={navItemClassName}>
                <Store /> Offerings
              </Link>
            )}
            {access.products.read && (
              <Link to="/products" className={navItemClassName}>
                <Layers /> Products
              </Link>
            )}
            {access.products.read && (
              <Link to="/carriers" className={navItemClassName}>
                <Landmark /> Carriers
              </Link>
            )}
            {access.documents.read && (
              <Link to="/documents/forms" className={navItemClassName}>
                <FileStack /> Forms library
              </Link>
            )}
            {access.extensions.read && (
              <Link to="/extensions" className={navItemClassName}>
                <Puzzle /> Extensions
              </Link>
            )}
          </NavSection>
        )}
      </div>
      <div className="grid gap-2">
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
        <span className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate text-sm font-semibold">{active?.name ?? "Organization"}</span>
          {active && isSandboxOrganization(active) && (
            <span className="text-xs text-amber-700">Sandbox</span>
          )}
        </span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations?.map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => switchTo(org.id)}>
            <span className="min-w-0 flex-1 truncate">{org.name}</span>
            {isSandboxOrganization(org) && <StatusChip tone="warning">Sandbox</StatusChip>}
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
