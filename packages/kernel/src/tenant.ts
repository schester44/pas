import type { Id } from "./id";

export type TenantId = Id<"Tenant">;
export type UserId = Id<"User">;

/** Who is acting, for which tenant. Required by every tenant-scoped use case and repository. */
export interface TenantContext {
  readonly tenantId: TenantId;
  readonly actor: Actor;
}

export type Actor =
  | { readonly type: "user"; readonly userId: UserId }
  | { readonly type: "api_client"; readonly clientId: string }
  | { readonly type: "system"; readonly process: string };
