import { loadSession } from "@pas/auth/client";
import { Brand } from "@pas/ui/components/brand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { createFileRoute, Link, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { SearchTrigger } from "@/components/search-palette";
import { authClient } from "@/lib/auth";
import { initials } from "@/lib/format";
import { currentTenant, useTenant } from "@/lib/tenant";
import { queryClient, useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async () => {
    const data = await loadSession(authClient);

    if (!data) throw redirect({ to: "/login" });

    const tenant = currentTenant();
    const { data: organizations } = await authClient.organization.list();

    if (tenant && !organizations?.some((o) => o.slug === tenant.slug)) {
      throw redirect({ to: "/portal" });
    }

    return { session: data };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const tenant = useTenant();
  const trpc = useTRPC();
  const agencies = useQuery({ ...trpc.agency.mine.queryOptions(), retry: false });

  return (
    <div className="min-h-svh bg-canvas">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4 sm:px-6">
          <Link to="/">
            <Brand name={tenant?.displayName} logoUrl={tenant?.logoUrl} />
          </Link>
          {agencies.data && agencies.data.length > 0 && (
            <Link
              to="/agency"
              className="text-sm font-medium text-muted-foreground hover:text-foreground [&.active]:text-foreground"
            >
              My agency
            </Link>
          )}
          <div className="ml-auto flex flex-1 items-center justify-end gap-3">
            <SearchTrigger userId={session.user.id} />
            <DropdownMenu>
              <DropdownMenuTrigger className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
                {initials(session.user.name)}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="grid">
                  <span className="truncate text-sm font-medium text-foreground">
                    {session.user.name}
                  </span>
                  <span className="truncate">{session.user.email}</span>
                </DropdownMenuLabel>
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
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-6 px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
