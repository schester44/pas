import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <AddressLookupBoundary>
          <RouterProvider router={router} />
        </AddressLookupBoundary>
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>,
);
