import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { LicenseRecord, ProducerLicenseLookup } from "../ports/producer-licensing";
import type { ProducerRepository } from "../ports/producer-repository";

/** The built-in licensing source: the licenses staff and agency admins keep on file. */
export class OnFileLicensing implements ProducerLicenseLookup {
  readonly provider = "licenses_on_file";

  constructor(private readonly deps: { uow: UnitOfWork; producers: ProducerRepository }) {}

  async licenses(ctx: TenantContext, producer: { producerId: string }): Promise<LicenseRecord[]> {
    const licenses = await this.deps.uow.run(ctx, (tx) =>
      this.deps.producers.licenses(tx, ctx, [producer.producerId]),
    );

    return licenses.map((l) => ({
      npn: l.npn,
      country: l.country,
      subdivision: l.subdivision,
      licenseNumber: l.licenseNumber,
      linesOfAuthority: l.linesOfAuthority,
      effectiveDate: l.effectiveDate.toString(),
      expirationDate: l.expirationDate?.toString() ?? null,
      status: l.status,
    }));
  }
}
