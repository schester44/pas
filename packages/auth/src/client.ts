import { adminClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { ac, roles } from "./permissions";

/** Browser auth client for the SPAs. `baseURL` is the API origin (proxied in dev). */
export function createPasAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [
      organizationClient({ ac, roles, dynamicAccessControl: { enabled: true } }),
      adminClient(),
    ],
  });
}

export type PasAuthClient = ReturnType<typeof createPasAuthClient>;
