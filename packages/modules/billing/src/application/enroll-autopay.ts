import {
  conflict,
  type ClockProvider,
  newId,
  notFound,
  type ProviderFor,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { SavedPaymentMethod } from "../domain/billing-schedule";
import type { BillingScheduleRepository } from "../ports/billing-schedule-repository";
import type { PaymentGateway, PaymentMethodInput } from "../ports/payment-gateway";
import type { BillingTimelineEntry } from "../ports/policy-timeline";
import type { ApplyBillingEvent } from "./apply-billing-event";

export const AUTOPAY_CONSENT =
  "I authorize the insurer to charge this card for each installment on its due date until the policy is paid in full or I turn autopay off.";

export interface EnrollAutopayInput {
  policyId: string;
  provider: string;
  methodRef: string;
  customerRef: string | null;
  method: { brand: string; last4: string; expMonth: number; expYear: number };
  consent: { acceptedAt: string; by: string };
  actor: BillingTimelineEntry["actor"];
}

type Deps = {
  uow: UnitOfWork;
  schedules: BillingScheduleRepository;
  applyEvent: ApplyBillingEvent;
  clocks: ClockProvider;
};

/** Saves the consented card and charges installments to it from now on. */
export function makeEnrollAutopay(deps: Deps) {
  return async function enrollAutopay(
    ctx: TenantContext,
    input: EnrollAutopayInput,
  ): Promise<void> {
    const clock = deps.clocks.forTenant(ctx.tenantId);

    await deps.uow.run(ctx, async (tx) => {
      const schedule = await deps.schedules.findByPolicy(tx, ctx, input.policyId);

      if (!schedule) throw notFound("Billing schedule", input.policyId);

      const method: SavedPaymentMethod = {
        id: newId(),
        policyId: input.policyId,
        provider: input.provider,
        providerRef: input.methodRef,
        customerRef: input.customerRef,
        ...input.method,
        consent: { text: AUTOPAY_CONSENT, ...input.consent },
        status: "active",
        createdAt: clock.now(),
        updatedAt: clock.now(),
      };

      await deps.schedules.savePaymentMethod(tx, ctx, method);
      schedule.useForAutopay(method.id, clock);
      await deps.schedules.save(tx, schedule);
    });

    await deps.applyEvent(ctx, {
      eventId: `autopay:${input.methodRef}`,
      source: "pas",
      type: "payment_method.updated",
      occurredAt: clock.now(),
      policyNumber: await policyNumberOf(deps, ctx, input.policyId),
      method: input.method,
      reason: `Autopay on with ${input.method.brand} ending ${input.method.last4}`,
      actor: input.actor,
    });
  };
}

async function policyNumberOf(deps: Deps, ctx: TenantContext, policyId: string) {
  const schedule = await deps.uow.run(ctx, (tx) => deps.schedules.findByPolicy(tx, ctx, policyId));

  return schedule!.toSnapshot().policyNumber;
}

export type EnrollAutopay = ReturnType<typeof makeEnrollAutopay>;

/** Turns autopay off, or on with a newly entered card (client portal, policy billing). */
export function makeSetAutopay(
  deps: Deps & { gateway: ProviderFor<PaymentGateway>; enroll: EnrollAutopay },
) {
  return async function setAutopay(
    ctx: TenantContext,
    input: {
      policyId: string;
      enabled: boolean;
      method?: PaymentMethodInput;
      payer: { name: string; email?: string };
      actor: BillingTimelineEntry["actor"];
    },
  ): Promise<{ status: "updated" } | { status: "declined"; message: string }> {
    const clock = deps.clocks.forTenant(ctx.tenantId);

    if (!input.enabled) {
      const off = await deps.uow.run(ctx, async (tx) => {
        const schedule = await deps.schedules.findByPolicy(tx, ctx, input.policyId);

        if (!schedule?.autopayMethodId) return null;

        const method = await deps.schedules.findPaymentMethod(tx, ctx, schedule.autopayMethodId);

        schedule.useForAutopay(null, clock);
        await deps.schedules.save(tx, schedule);

        if (method) {
          await deps.schedules.savePaymentMethod(tx, ctx, {
            ...method,
            status: "removed",
            updatedAt: clock.now(),
          });
        }

        return { number: schedule.toSnapshot().policyNumber, method };
      });

      if (off) {
        await deps.applyEvent(ctx, {
          eventId: `autopay-off:${input.policyId}:${clock.now().epochMilliseconds}`,
          source: "pas",
          type: "payment_method.updated",
          occurredAt: clock.now(),
          policyNumber: off.number,
          reason: "Autopay turned off",
          actor: input.actor,
        });
      }

      return { status: "updated" };
    }

    if (!input.method) throw conflict("Enter a card to turn autopay on");

    const gateway = await deps.gateway.for(ctx);

    const saved = await gateway.saveMethod(ctx, {
      reference: input.policyId,
      method: input.method,
      customer: input.payer,
    });

    if (saved.status === "declined") return { status: "declined", message: saved.message };

    await deps.enroll(ctx, {
      policyId: input.policyId,
      provider: gateway.provider,
      methodRef: saved.methodRef,
      customerRef: saved.customerRef,
      method: saved.method,
      consent: { acceptedAt: clock.now().toString(), by: input.payer.name },
      actor: input.actor,
    });

    return { status: "updated" };
  };
}

export type SetAutopay = ReturnType<typeof makeSetAutopay>;
