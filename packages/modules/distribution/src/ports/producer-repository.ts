import type { TenantContext, Transaction } from "@pas/kernel";
import type { License } from "../domain/license";
import type { Appointment, Producer } from "../domain/producer";

export interface ProducerRepository {
  list(
    tx: Transaction,
    ctx: TenantContext,
    filter: { agencyIds?: readonly string[] },
  ): Promise<Producer[]>;
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<Producer | null>;
  findByUser(tx: Transaction, ctx: TenantContext, userId: string): Promise<Producer | null>;
  findByEmail(tx: Transaction, ctx: TenantContext, email: string): Promise<Producer | null>;
  save(tx: Transaction, ctx: TenantContext, producer: Producer): Promise<void>;
  licenses(tx: Transaction, ctx: TenantContext, producerIds: readonly string[]): Promise<License[]>;
  saveLicense(tx: Transaction, ctx: TenantContext, license: License): Promise<void>;
  deleteLicense(
    tx: Transaction,
    ctx: TenantContext,
    key: { producerId: string; id: string },
  ): Promise<void>;
  appointments(
    tx: Transaction,
    ctx: TenantContext,
    filter: { agencyIds?: readonly string[]; producerIds?: readonly string[] },
  ): Promise<Appointment[]>;
  saveAppointment(tx: Transaction, ctx: TenantContext, appointment: Appointment): Promise<void>;
}
