import type { ClockProvider, UnitOfWork } from "@pas/kernel";
import type { AgencyRepository } from "../ports/agency-repository";
import type { CommissionRepository } from "../ports/commission-repository";
import type { ProducerRepository } from "../ports/producer-repository";

export interface DistributionDeps {
  uow: UnitOfWork;
  agencies: AgencyRepository;
  producers: ProducerRepository;
  commissions: CommissionRepository;
  clocks: ClockProvider;
}

/** Days before expiry that a license shows as expiring. */
export const LICENSE_WARN_DAYS = 60;
