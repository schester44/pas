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

type SessionResult = Awaited<ReturnType<PasAuthClient["getSession"]>>;
type Session = NonNullable<SessionResult["data"]>;

export class AuthUnavailableError extends Error {
  constructor() {
    super("We couldn't reach the server. Check your connection and try again.");
  }
}

const RETRY_DELAYS_MS = [300, 800, 1500, 3000];

/** Null only when the server answers that there is no session; outages retry, then throw. */
export async function loadSession(
  client: PasAuthClient,
  query?: { disableCookieCache?: boolean },
): Promise<Session | null> {
  for (let attempt = 0; ; attempt++) {
    const result = await client.getSession(query ? { query } : undefined).catch(() => null);

    if (result && !result.error) return result.data ?? null;

    if (result?.error && result.error.status > 0 && result.error.status < 500) {
      return result.error.status === 401 ? null : Promise.reject(new AuthUnavailableError());
    }

    const delay = RETRY_DELAYS_MS[attempt];

    if (delay === undefined) throw new AuthUnavailableError();

    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
