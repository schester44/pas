import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { SubjectRef, UsageRole } from "../domain/clearance";
import type { AddressUsages } from "../ports/address-usages";

export interface TrackUsageInput {
  subject: SubjectRef;
  label: string;
  productId?: string | null;
  producer?: { id: string; name: string } | null;
  active: boolean;
  addresses: readonly { addressId: string; role: UsageRole }[];
}

/** Records which registry records a submission, policy or account uses, replacing the last set. */
export function makeTrackAddressUsage(deps: { uow: UnitOfWork; usages: AddressUsages }) {
  async function track(ctx: TenantContext, input: TrackUsageInput): Promise<void> {
    const roles = [...new Set(input.addresses.map((a) => a.role))];

    await deps.uow.run(ctx, (tx) =>
      deps.usages.replace(
        tx,
        ctx,
        input.subject,
        roles.length > 0 ? roles : ["location", "mailing"],
        input.addresses.map((a) => ({
          addressId: a.addressId,
          subject: input.subject,
          label: input.label,
          role: a.role,
          productId: input.productId ?? null,
          producer: input.producer ?? null,
          active: input.active,
        })),
      ),
    );
  }

  async function setActive(
    ctx: TenantContext,
    subject: SubjectRef,
    active: boolean,
  ): Promise<void> {
    await deps.uow.run(ctx, (tx) => deps.usages.setActive(tx, ctx, subject, active));
  }

  return Object.assign(track, { setActive });
}

export type TrackAddressUsage = ReturnType<typeof makeTrackAddressUsage>;
