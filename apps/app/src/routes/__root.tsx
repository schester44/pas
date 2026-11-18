import { SandboxBanner } from "@pas/ui/components/sandbox-banner";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useTenant } from "@/lib/tenant";

export const Route = createRootRoute({
  component: Root,
});

function Root() {
  const tenant = useTenant();

  return (
    <>
      {tenant?.sandbox && (
        <SandboxBanner name={tenant.displayName} time="Test payments and e-signature" />
      )}
      <Outlet />
    </>
  );
}
