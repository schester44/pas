import { evaluate } from "@pas/expressions";
import { POINT_SPECS } from "@pas/extension-points";
import {
  type DomainEvent,
  type Instant,
  invalid,
  type TenantContext,
  toPlainJson,
  type WorkflowStep,
  type Workflows,
  workflowRef,
  workflowSubject,isRecord
} from "@pas/kernel";
import type { AutomationServices, HostServices } from "../ports/services";
import type { ExtensionDeps } from "./deps";
import type { RunExtension } from "./run-extension";

/** A domain event as the queue delivers it (timestamps serialized). */
export type AutomationEvent = Omit<DomainEvent, "occurredAt" | "tenantId"> & {
  occurredAt: string | Instant;
};

export interface AutomationInput {
  subscriptionId: string;
  event: {
    id: string;
    type: string;
    aggregateType: string;
    aggregateId: string;
    occurredAt: string;
    payload: unknown;
  };
}

export const automationWorkflow = workflowRef<AutomationInput>("extensions.automation", {
  parse(value) {
    if (!isRecord(value) || typeof value.subscriptionId !== "string" || !isRecord(value.event)) {
      throw invalid("extensions.automation needs a subscriptionId and an event");
    }

    return value as unknown as AutomationInput;
  },
});

export interface DispatchedAutomation {
  subscriptionId: string;
  status: "started" | "skipped";
  runId?: string;
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
 * Starts one durable run per subscription whose condition holds. The run is keyed on the
 * subscription and the event, so a redelivered event can't start it twice, and tenant code
 * failing never fails the shared domain-event job.
 */
export function makeDispatchAutomations(
  deps: Pick<ExtensionDeps, "uow" | "subscriptions"> & { workflows?: () => Workflows },
) {
  return async function dispatchAutomations(
    ctx: TenantContext,
    event: AutomationEvent,
  ): Promise<DispatchedAutomation[]> {
    const subscriptions = await deps.uow.run(ctx, (tx) =>
      deps.subscriptions.enabledFor(tx, ctx, event.type),
    );

    if (subscriptions.length === 0) return [];

    if (!deps.workflows) throw new Error("Automations need the workflow engine");

    const payload: AutomationInput["event"] = toPlainJson({
      id: event.id,
      type: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      occurredAt: event.occurredAt.toString(),
      payload: event.payload,
    });

    return Promise.all(
      subscriptions.map(async (subscription): Promise<DispatchedAutomation> => {
        if (!conditionHolds(subscription.condition, payload)) {
          return { subscriptionId: subscription.id, status: "skipped" };
        }

        const { runId } = await deps.workflows!().start(
          ctx,
          automationWorkflow,
          { subscriptionId: subscription.id, event: payload },
          {
            idempotencyKey: `${subscription.id}:${event.id}`,
            subjects: [
              workflowSubject("extension", subscription.extensionId),
              workflowSubject(event.aggregateType, event.aggregateId),
            ],
          },
        );

        return { subscriptionId: subscription.id, status: "started", runId };
      }),
    );
  };
}

/**
 * The body of an automation run. Each PAS service call is a durable step numbered in call order,
 * so a retry replays completed calls (no second email or note) and runs the rest.
 */
export function makeRunAutomation(
  deps: Pick<ExtensionDeps, "uow" | "subscriptions" | "extensions"> & {
    runExtension: RunExtension;
    services: AutomationServices;
  },
) {
  return async function runAutomation(
    ctx: TenantContext,
    input: AutomationInput,
    step: WorkflowStep,
  ): Promise<{ status: "succeeded" | "gone" }> {
    const subscription = await step.run("load", () =>
      deps.uow.run(ctx, async (tx) => {
        const found = await deps.subscriptions.find(tx, ctx, input.subscriptionId as never);

        if (!found) return null;

        const version = await deps.extensions.findVersion(tx, ctx, found.extensionVersionId);

        return {
          versionId: found.extensionVersionId as string,
          services: version?.manifest.services ?? [],
        };
      }),
    );

    if (!subscription) return { status: "gone" };

    let call = 0;

    const services: HostServices = Object.fromEntries(
      Object.entries(
        deps.services.build(ctx, subscription.services, { runId: input.event.id }),
      ).map(([name, fn]) => [
        name,
        (args: unknown) => step.run(`service:${call++}:${name}`, () => fn(args)),
      ]),
    );

    const result = await deps.runExtension(ctx, {
      extensionVersionId: subscription.versionId,
      point: "automation",
      input: { event: input.event },
      timeoutMs: POINT_SPECS.automation.defaultTimeoutMs,
      subject: { type: "automation", id: `${input.subscriptionId}:${input.event.id}` },
      // The extension's own step ids get a prefix so they can't collide with ours.
      step: { ...step, run: (id, fn) => step.run(`extension:${id}`, fn) },
      services,
    });

    if (!result.ok) throw new Error(`Automation failed: ${result.error.message}`);

    return { status: "succeeded" };
  };
}

export type DispatchAutomations = ReturnType<typeof makeDispatchAutomations>;
export type RunAutomation = ReturnType<typeof makeRunAutomation>;
