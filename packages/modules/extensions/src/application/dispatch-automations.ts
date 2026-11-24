import { evaluate } from "@pas/expressions";
import { POINT_SPECS } from "@pas/extension-points";
import {
  type DomainEvent,
  type Instant,
  type TenantContext,
  toPlainJson,
  type WorkflowStep,
} from "@pas/kernel";
import type { AutomationServices } from "../ports/services";
import type { ExtensionDeps } from "./deps";
import type { RunExtension } from "./run-extension";

/** A domain event as the queue delivers it (timestamps serialized). */
export type AutomationEvent = Omit<DomainEvent, "occurredAt" | "tenantId"> & {
  occurredAt: string | Instant;
};

export interface DispatchedAutomation {
  subscriptionId: string;
  status: "succeeded" | "failed" | "skipped" | "already_ran";
  runId?: string;
  message?: string;
}

const conditionHolds = (condition: string | null, event: Record<string, unknown>) => {
  if (!condition) return true;

  try {
    return evaluate(condition, { event }) === true;
  } catch {
    return false;
  }
};

/**
 * Runs the automations subscribed to an event. Idempotent per subscription and event: one that
 * already succeeded for this event isn't run again when the queue redelivers it.
 */
export function makeDispatchAutomations(
  deps: Pick<ExtensionDeps, "uow" | "subscriptions" | "runs" | "extensions"> & {
    runExtension: RunExtension;
    services: AutomationServices;
  },
) {
  return async function dispatchAutomations(
    ctx: TenantContext,
    event: AutomationEvent,
    step?: WorkflowStep,
  ): Promise<DispatchedAutomation[]> {
    const subscriptions = await deps.uow.run(ctx, (tx) =>
      deps.subscriptions.enabledFor(tx, ctx, event.type),
    );

    if (subscriptions.length === 0) return [];

    const payload = toPlainJson({
      id: event.id,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAt.toString(),
      payload: event.payload,
    });

    return Promise.all(
      subscriptions.map(async (subscription): Promise<DispatchedAutomation> => {
        const subject = { type: "automation", id: `${subscription.id}:${event.id}` };

        const previous = await deps.uow.run(ctx, (tx) =>
          deps.runs.list(tx, ctx, { subject, status: "succeeded", limit: 1 }),
        );

        if (previous.length > 0) return { subscriptionId: subscription.id, status: "already_ran" };

        if (!conditionHolds(subscription.condition, payload)) {
          return { subscriptionId: subscription.id, status: "skipped" };
        }

        const version = await deps.uow.run(ctx, (tx) =>
          deps.extensions.findVersion(tx, ctx, subscription.extensionVersionId),
        );

        const result = await deps.runExtension(ctx, {
          extensionVersionId: subscription.extensionVersionId,
          point: "automation",
          input: { event: payload },
          timeoutMs: POINT_SPECS.automation.defaultTimeoutMs,
          subject,
          ...(step && { step }),
          services: deps.services.build(ctx, version?.manifest.services ?? [], { runId: event.id }),
        });

        return result.ok
          ? { subscriptionId: subscription.id, status: "succeeded", runId: result.run.id }
          : {
              subscriptionId: subscription.id,
              status: "failed",
              runId: result.run.id,
              message: result.error.message,
            };
      }),
    );
  };
}

export type DispatchAutomations = ReturnType<typeof makeDispatchAutomations>;
