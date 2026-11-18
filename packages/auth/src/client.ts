import { adminClient, emailOTPClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { ac, roles } from "./permissions";

/** Browser auth client for the SPAs. `baseURL` is the API origin (proxied in dev). */
export function createPasAuthClient(baseURL: string, headers?: () => Record<string, string>) {
  return createAuthClient({
    baseURL,
    ...(headers && {
      fetchOptions: {
        onRequest: (context: { headers: Headers }) => {
          for (const [key, value] of Object.entries(headers())) context.headers.set(key, value);
        },
      },
    }),
    plugins: [
      organizationClient({ ac, roles, dynamicAccessControl: { enabled: true } }),
      adminClient(),
      emailOTPClient(),
    ],
  });
}

export type PasAuthClient = ReturnType<typeof createPasAuthClient>;
