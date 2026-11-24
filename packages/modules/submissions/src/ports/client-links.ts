/** Unguessable links to a client request; nothing secret is stored, so a token can be re-derived. */
export interface ClientLinks {
  token(requestId: string): string;
  /** The request a token names, or null when it was forged or tampered with. */
  verify(token: string): string | null;
}

/** Where the agent app serves a client request, relative to the tenant's app URL. */
export const clientApplicationPath = (token: string) => `/apply/${encodeURIComponent(token)}`;
