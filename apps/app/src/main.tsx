import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { CloudOff, MapPinOff } from "lucide-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StatusScreen } from "./lib/status-screen";
import { applyBranding, type ResolvedTenant, resolveTenant, TenantProvider } from "./lib/tenant";
import { AddressLookupBoundary } from "./lib/address-lookup";
import { queryClient, TRPCProvider, trpcClient } from "./lib/trpc";
import { routeTree } from "./routeTree.gen";
import "./styles.css";

const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = createRoot(document.getElementById("root")!);

void resolveTenant().then(render, () => render("error"));

function render(resolved: ResolvedTenant | "error") {
  if (resolved === "error") {
    document.title = "Something went wrong";

    root.render(
      <StatusScreen
        icon={<CloudOff />}
        title="We couldn't load this page"
        description="Check your connection and try again."
        action={{ label: "Try again", onClick: () => window.location.reload() }}
      />,
    );
  } else if (resolved.status === "not_found") {
    document.title = "Page not found";

    root.render(
      <StatusScreen
        icon={<MapPinOff />}
        title="We couldn't find that page"
        description="Check the address, or ask whoever sent you the link for the right one."
      />,
    );
  } else {
    const tenant = resolved.status === "tenant" ? resolved.tenant : null;
    applyBranding(tenant);

    root.render(
      <StrictMode>
        <TenantProvider value={tenant}>
          <QueryClientProvider client={queryClient}>
            <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
              <AddressLookupBoundary>
                <RouterProvider router={router} />
              </AddressLookupBoundary>
            </TRPCProvider>
          </QueryClientProvider>
        </TenantProvider>
      </StrictMode>,
    );
  }
}
