import type { TenantContext, Transaction } from "@pas/kernel";
import type { Edition } from "../domain/edition";
import type { FormEdition, FormEditionId } from "../domain/form-edition";

export interface FormEditionRepository {
  insert(tx: Transaction, edition: FormEdition): Promise<void>;
  findById(tx: Transaction, ctx: TenantContext, id: FormEditionId): Promise<FormEdition | null>;
  list(tx: Transaction, ctx: TenantContext): Promise<FormEdition[]>;
  exists(
    tx: Transaction,
    ctx: TenantContext,
    formNumber: string,
    edition: Edition,
  ): Promise<boolean>;
  existingIds(tx: Transaction, ctx: TenantContext, ids: readonly string[]): Promise<Set<string>>;
}
