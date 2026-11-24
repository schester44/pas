import { validate } from "@pas/expressions";
import { asId, invalid, newId, notFound, type TenantContext } from "@pas/kernel";
import { type AutomationSubscription, checkEventTypes } from "../domain/subscription";
import type { ExtensionDeps } from "./deps";
import { type SubscriptionDto, toSubscriptionDto } from "./dto";
import { loadExtension, loadVersion } from "./load";

export function makeSaveSubscription(
  deps: Pick<ExtensionDeps, "uow" | "extensions" | "subscriptions" | "clocks">,
) {
  return async function saveSubscription(
    ctx: TenantContext,
    input: {
      id?: string;
      extensionId: string;
      extensionVersionId: string;
      eventTypes: string[];
      condition?: string | null;
      enabled: boolean;
    },
  ): Promise<SubscriptionDto> {
    const eventTypes = checkEventTypes(input.eventTypes);
    const condition = input.condition?.trim() || null;

    if (condition) {
      const checked = validate(condition);

      if (!checked.ok)
        throw invalid(`The condition doesn't parse: ${checked.message}`, { field: "condition" });
    }

    return deps.uow.run(ctx, async (tx) => {
      const extension = await loadExtension(deps.extensions, tx, ctx, input.extensionId);
      const version = await loadVersion(deps.extensions, tx, ctx, input.extensionVersionId);

      if (version.extensionId !== extension.id) throw invalid("Choose a version of this extension");

      if (!version.manifest.points.includes("automation")) {
        throw invalid(`Version ${version.version} doesn't implement automation`, {
          field: "extensionVersionId",
        });
      }

      const now = deps.clocks.forTenant(ctx.tenantId).now();
      const existing = input.id ? await deps.subscriptions.find(tx, ctx, asId(input.id)) : null;

      if (input.id && !existing) throw notFound("Automation", input.id);

      const subscription: AutomationSubscription = {
        id: existing?.id ?? newId(),
        tenantId: ctx.tenantId,
        extensionId: extension.id,
        extensionVersionId: version.id,
        eventTypes,
        condition,
        enabled: input.enabled,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      await deps.subscriptions.save(tx, subscription);

      return toSubscriptionDto(subscription);
    });
  };
}

export function makeDeleteSubscription(deps: Pick<ExtensionDeps, "uow" | "subscriptions">) {
  return async function deleteSubscription(ctx: TenantContext, input: { id: string }) {
    await deps.uow.run(ctx, (tx) => deps.subscriptions.delete(tx, ctx, asId(input.id)));
  };
}

export type SaveSubscription = ReturnType<typeof makeSaveSubscription>;
export type DeleteSubscription = ReturnType<typeof makeDeleteSubscription>;
