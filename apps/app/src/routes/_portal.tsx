import { loadSession } from "@pas/auth/client";
import { Brand } from "@pas/ui/components/brand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth";
import { initials } from "@/lib/format";
import { useTenant } from "@/lib/tenant";
import { queryClient, useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_portal")({
  beforeLoad: async () => {
    const data = await loadSession(authClient);

    if (!data) throw redirect({ to: "/login", search: { as: "client" } });

    return { session: data };
  },
  component: PortalLayout,
});

function PortalLayout() {
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const tenant = useTenant();
  const trpc = useTRPC();
  const me = useQuery(trpc.client.me.queryOptions());
  const label = me.data?.user.name || session.user.name || session.user.email;

  return (
    <div className="min-h-svh bg-canvas">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4 sm:px-6">
          <Link to="/portal">
            <Brand name={tenant?.displayName} logoUrl={tenant?.logoUrl} />
          </Link>
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Account"
                className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {initials(label) || label.charAt(0).toUpperCase()}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="grid">
                  {label !== session.user.email && (
                    <span className="truncate text-sm font-medium text-foreground">{label}</span>
                  )}
                  <span className="truncate">{session.user.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={async () => {
                    await authClient.signOut();
                    queryClient.clear();
                    await router.navigate({ to: "/login", search: { as: "client" } });
                  }}
                >
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-8 px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
        <Outlet />
      </main>
    </div>
  );
}
