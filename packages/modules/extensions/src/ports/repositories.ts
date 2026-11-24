import type { Instant, TenantContext, Transaction } from "@pas/kernel";
import type { Extension, ExtensionId } from "../domain/extension";
import type { ExtensionRun, ExtensionRunId } from "../domain/run";
import type { SealedSecret, StoredSecret } from "../domain/secret";
import type { AutomationSubscription, SubscriptionId } from "../domain/subscription";
import type { ExtensionVersion, ExtensionVersionId } from "../domain/version";

export interface ExtensionRepository {
  save(tx: Transaction, extension: Extension): Promise<void>;
  findById(tx: Transaction, ctx: TenantContext, id: ExtensionId): Promise<Extension | null>;
  findByKey(tx: Transaction, ctx: TenantContext, key: string): Promise<Extension | null>;
  list(tx: Transaction, ctx: TenantContext): Promise<Extension[]>;

  insertVersion(tx: Transaction, version: ExtensionVersion): Promise<void>;
  findVersion(
    tx: Transaction,
    ctx: TenantContext,
    id: ExtensionVersionId,
  ): Promise<ExtensionVersion | null>;
  findVersions(
    tx: Transaction,
    ctx: TenantContext,
    ids: readonly ExtensionVersionId[],
  ): Promise<ExtensionVersion[]>;
  versions(
    tx: Transaction,
    ctx: TenantContext,
    extensionId: ExtensionId,
  ): Promise<ExtensionVersion[]>;
  /** Published versions across extensions, newest first, without code or source. */
  publishedVersions(tx: Transaction, ctx: TenantContext): Promise<ExtensionVersion[]>;

  secrets(tx: Transaction, ctx: TenantContext, extensionId: ExtensionId): Promise<StoredSecret[]>;
  putSecret(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      extensionId: ExtensionId;
      name: string;
      sealed: SealedSecret;
      hint: string;
      at: Instant;
    },
  ): Promise<void>;
  deleteSecret(
    tx: Transaction,
    ctx: TenantContext,
    input: { extensionId: ExtensionId; name: string },
  ): Promise<void>;
}

export interface SubscriptionRepository {
  save(tx: Transaction, subscription: AutomationSubscription): Promise<void>;
  delete(tx: Transaction, ctx: TenantContext, id: SubscriptionId): Promise<void>;
  find(
    tx: Transaction,
    ctx: TenantContext,
    id: SubscriptionId,
  ): Promise<AutomationSubscription | null>;
  forExtension(
    tx: Transaction,
    ctx: TenantContext,
    extensionId: ExtensionId,
  ): Promise<AutomationSubscription[]>;
  enabledFor(
    tx: Transaction,
    ctx: TenantContext,
    eventType: string,
  ): Promise<AutomationSubscription[]>;
}

export interface RunFilter {
  extensionId?: ExtensionId;
  subject?: { type: string; id: string };
  status?: ExtensionRun["status"];
  before?: Instant;
  limit: number;
}

export interface ExtensionRunRepository {
  insert(tx: Transaction, run: ExtensionRun): Promise<void>;
  find(tx: Transaction, ctx: TenantContext, id: ExtensionRunId): Promise<ExtensionRun | null>;
  /** Newest first, without inputs, outputs or network. */
  list(tx: Transaction, ctx: TenantContext, filter: RunFilter): Promise<ExtensionRun[]>;
}
