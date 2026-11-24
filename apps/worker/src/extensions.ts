import type { AutomationServices, HostServices } from "@pas/extensions";
import { composeExtensions, sandboxSettingsFromEnv } from "@pas/extensions/infrastructure";
import { AesSecretBox } from "@pas/integrations/infrastructure";
import type { Outbox, TenantContext, Transaction, UnitOfWork, Workflows } from "@pas/kernel";
import type { makeRecordPolicyEvent } from "@pas/policy";
import type { TenantClocks } from "@pas/tenants/infrastructure";
import { z } from "zod";

const addNote = z.object({
  policyId: z.uuid(),
  summary: z.string().trim().min(1).max(300),
  detail: z.string().max(4_000).optional(),
});

const sendEmail = z.object({
  to: z.email(),
  subject: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(20_000),
});

/**
 * The PAS SDK for automations: each service runs the same use case a person would, as the
 * tenant's automation actor, and only the services the extension version declared are offered.
 */
function automationServices(deps: {
  uow: UnitOfWork;
  recordPolicyEvent: ReturnType<typeof makeRecordPolicyEvent>;
  sendEmail: (
    ctx: TenantContext,
    message: { to: string; subject: string; text: string; tag: string },
  ) => Promise<void>;
}): AutomationServices {
  const all = (ctx: TenantContext, runId: string): HostServices => ({
    "pas.policy.addNote": async (args) => {
      const note = addNote.parse(args);

      await deps.uow.run(ctx, (tx: Transaction) =>
        deps.recordPolicyEvent(tx, ctx, {
          policyId: note.policyId,
          type: "note",
          actor: { type: "system", name: "Automation" },
          summary: note.summary,
          data: { ...(note.detail && { detail: note.detail }), automationEventId: runId },
        }),
      );

      return { ok: true };
    },
    "pas.email.send": async (args) => {
      const email = sendEmail.parse(args);

      await deps.sendEmail(ctx, { ...email, tag: "automation" });

      return { ok: true };
    },
  });

  return {
    build: (ctx, granted, { runId }) =>
      Object.fromEntries(
        Object.entries(all(ctx, runId)).filter(([name]) => granted.includes(name)),
      ),
  };
}

export function composeWorkerExtensions(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: TenantClocks;
  recordPolicyEvent: ReturnType<typeof makeRecordPolicyEvent>;
  sendEmail: Parameters<typeof automationServices>[0]["sendEmail"];
  workflows: () => Workflows;
}) {
  return composeExtensions({
    uow: deps.uow,
    outbox: deps.outbox,
    clocks: deps.clocks,
    secretBox: new AesSecretBox(process.env.INTEGRATIONS_SECRET_KEY),
    isSandbox: async (ctx) => {
      await deps.clocks.refresh(ctx.tenantId);

      return deps.clocks.isSandbox(ctx.tenantId);
    },
    ...sandboxSettingsFromEnv(),
    automationServices: automationServices(deps),
    workflows: deps.workflows,
  });
}
