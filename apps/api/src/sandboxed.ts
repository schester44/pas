import type { TenantContext } from "@pas/kernel";

const isTenantContext = (value: unknown): value is TenantContext =>
  typeof value === "object" && value !== null && "tenantId" in value;

/** Routes each call to `fake` when its tenant is a sandbox, so sandboxes never reach real providers. */
export function sandboxed<T extends object>(
  environments: { isSandbox(tenantId: string): boolean },
  live: T,
  fake: T,
): T {
  return new Proxy(live, {
    get(target, property) {
      const value = Reflect.get(target, property);

      if (typeof value !== "function") return value;

      return (...args: unknown[]) => {
        const [ctx] = args;
        const impl = isTenantContext(ctx) && environments.isSandbox(ctx.tenantId) ? fake : target;

        return Reflect.apply(
          Reflect.get(impl, property) as (...a: unknown[]) => unknown,
          impl,
          args,
        );
      };
    },
  });
}
