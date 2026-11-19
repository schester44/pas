import { type Jurisdiction, parsePlainDate, type TenantContext } from "@pas/kernel";
import { checkLicense, type LicenseCheck, type LicensingMode } from "../domain/license";
import type { ProducerLicensing } from "../ports/producer-licensing";
import type { DistributionDeps } from "./deps";

export interface LicensingResult {
  mode: LicensingMode;
  producerName: string | null;
  check: LicenseCheck;
  /** Blocks bind: unlicensed under a product whose mode is `block`. */
  blocks: boolean;
  /** Ready to show: "Morgan Lee has no license in Indiana". */
  message: string | null;
}

type Deps = Pick<DistributionDeps, "uow" | "producers" | "commissions"> & {
  licensing: ProducerLicensing;
  placeName: (jurisdiction: Jurisdiction) => string;
};

/** PLAN §11: is the producer of record licensed for this product in the risk state on this date? */
export function makeCheckProducerLicense(deps: Deps) {
  return async function checkProducerLicense(
    ctx: TenantContext,
    input: { userId: string; productId: string; jurisdiction: Jurisdiction; effectiveDate: string },
  ): Promise<LicensingResult> {
    const { producer, requirement } = await deps.uow.run(ctx, async (tx) => ({
      producer: await deps.producers.findByUser(tx, ctx, input.userId),
      requirement: (await deps.commissions.requirements(tx, ctx)).find(
        (r) => r.productId === input.productId,
      ),
    }));

    const mode = requirement?.mode ?? "off";

    if (mode === "off") {
      return {
        mode,
        producerName: producer?.name ?? null,
        check: { ok: true, licenseNumber: "" },
        blocks: false,
        message: null,
      };
    }

    const place = deps.placeName(input.jurisdiction);

    const check: LicenseCheck = !producer
      ? { ok: false, reason: "no_license", message: "isn't set up as a producer" }
      : !input.jurisdiction.subdivision
        ? { ok: false, reason: "no_license", message: `has no license in ${place}` }
        : checkLicense(
            (
              await (
                await deps.licensing.for(ctx)
              ).licenses(ctx, { producerId: producer.id, npn: producer.npn })
            ).map((record) => ({
              ...record,
              effectiveDate: parsePlainDate(record.effectiveDate),
              expirationDate: record.expirationDate ? parsePlainDate(record.expirationDate) : null,
            })),
            {
              subdivision: input.jurisdiction.subdivision,
              linesOfAuthority: requirement?.linesOfAuthority ?? [],
              on: parsePlainDate(input.effectiveDate),
              place,
            },
          );

    const name = producer?.name ?? "The producer";

    return {
      mode,
      producerName: producer?.name ?? null,
      check,
      blocks: !check.ok && mode === "block",
      message: check.ok ? null : `${name} ${check.message}`,
    };
  };
}

export type CheckProducerLicense = ReturnType<typeof makeCheckProducerLicense>;
