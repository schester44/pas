import { SandboxBanner } from "@pas/ui/components/sandbox-banner";
import { useQuery } from "@tanstack/react-query";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { type TenantBranding, useTenant } from "@/lib/tenant";
import { TENANT_SLUG_KEY, useTRPC } from "@/lib/trpc";

export const Route = createRootRoute({
  component: Root,
});

function Root() {
  const tenant = useTenant();

  return (
    <>
      {tenant?.sandbox && <EnvironmentBanner tenant={tenant} />}
      <Outlet />
    </>
  );
}

const sandboxTime = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function EnvironmentBanner({ tenant }: { tenant: TenantBranding }) {
  const trpc = useTRPC();

  const time = useQuery({
    ...trpc.tenant.sandboxTime.queryOptions({
      host: window.location.host,
      slug: sessionStorage.getItem(TENANT_SLUG_KEY),
    }),
    staleTime: 5_000,
    refetchInterval: 60_000,
  });

  return (
    <SandboxBanner
      name={tenant.displayName}
      time={time.data && `Sandbox time ${sandboxTime.format(new Date(time.data.now))}`}
    />
  );
}
