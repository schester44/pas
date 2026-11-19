import { createHash } from "node:crypto";
import {
  canonicalJson,
  type ClockProvider,
  conflict,
  newId,
  type Outbox,
  type TenantContext,
  type Transaction,
  type UnitOfWork,
} from "@pas/kernel";
import { type EntryActor, type EntryDraft, JournalEntry } from "../domain/journal";
import { accrualTriggers, accrueCommission } from "./commission-accrual";
import type { CanonicalBillingEvent, CardRefunds, PasBilling } from "../ports/pas-billing";
import type { LedgerQueries } from "../ports/queries";
import type {
  AuditTrail,
  CommissionRepository,
  DepositBatchRepository,
  IdempotencyStore,
  JournalRepository,
  LockboxRepository,
  PaymentRepository,
  ReceivableRepository,
  ReconciliationRepository,
  RefundRepository,
  SettingsRepository,
  WriteOffRepository,
} from "../ports/repositories";

export interface LedgerDeps {
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  journal: JournalRepository;
  receivables: ReceivableRepository;
  commissions: CommissionRepository;
  payments: PaymentRepository;
  batches: DepositBatchRepository;
  lockbox: LockboxRepository;
  refunds: RefundRepository;
  writeOffs: WriteOffRepository;
  settings: SettingsRepository;
  idempotency: IdempotencyStore;
  audit: AuditTrail;
  reconciliations: ReconciliationRepository;
  queries: LedgerQueries;
  pas: PasBilling;
  cards: CardRefunds;
}

export const SYSTEM: EntryActor = { type: "system", name: "Native billing" };

/** Who asked, and the key that makes a retried request a no-op. */
export interface CommandMeta {
  actor: EntryActor;
  idempotencyKey?: string | undefined;
}

export const clockOf = (deps: Pick<LedgerDeps, "clocks">, ctx: TenantContext) =>
  deps.clocks.forTenant(ctx.tenantId);

export const todayOf = (deps: Pick<LedgerDeps, "clocks">, ctx: TenantContext) =>
  clockOf(deps, ctx).today("UTC");

/** Canonical events the ledger reports to PAS carry this source; the key of their journal entry. */
export const NATIVE_SOURCE = "native";

export const eventKey = (source: string, eventId: string) => `event:${source}:${eventId}`;

export async function post(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  draft: EntryDraft,
): Promise<{ entry: JournalEntry; posted: boolean }> {
  const result = await deps.journal.post(
    tx,
    ctx,
    JournalEntry.draft({ ...draft, tenantId: ctx.tenantId }, clockOf(deps, ctx)),
  );

  if (result.posted) {
    for (const trigger of accrualTriggers(result.entry)) {
      await accrueCommission(deps, tx, ctx, { ...trigger, trigger: result.entry.key });
    }
  }

  return result;
}

export async function audit(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  meta: CommandMeta,
  input: {
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await deps.audit.record(tx, ctx, {
    ...input,
    before: input.before ?? null,
    after: input.after ?? null,
    actor: meta.actor,
    idempotencyKey: meta.idempotencyKey ?? null,
    occurredAt: clockOf(deps, ctx).now(),
  });
}

/** Queues canonical events for PAS through the outbox, so they exist iff the posting committed. */
export async function emit(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  events: readonly CanonicalBillingEvent[],
  actor: EntryActor,
): Promise<void> {
  if (events.length === 0) return;

  const now = clockOf(deps, ctx).now();

  await deps.outbox.add(
    tx,
    events.map((event) => ({
      id: newId(),
      type: "ledger.billing_event",
      tenantId: ctx.tenantId,
      aggregateType: "ledger",
      aggregateId: event.id,
      occurredAt: now,
      payload: { event, actor },
    })),
  );
}

const hashOf = (request: unknown) =>
  createHash("sha256").update(canonicalJson(request)).digest("hex");

export interface CommandWork<T> {
  result: T;
  events?: CanonicalBillingEvent[];
}

/**
 * One ledger command in one transaction: claim the idempotency key, do the work, queue the
 * canonical events and store the response with the key. A retry with the same key and request
 * returns the stored response; the same key with a different request is refused. Events are
 * applied to PAS straight after commit, and the outbox delivers them again if that fails.
 */
export async function runCommand<T>(
  deps: LedgerDeps,
  ctx: TenantContext,
  command: { action: string; request: unknown; meta: CommandMeta },
  work: (tx: Transaction) => Promise<CommandWork<T>>,
): Promise<T> {
  const key = command.meta.idempotencyKey;
  const requestHash = hashOf({ action: command.action, request: command.request });

  const outcome = await deps.uow.run(ctx, async (tx) => {
    if (key) {
      const claim = await deps.idempotency.claim(tx, ctx, {
        key,
        action: command.action,
        requestHash,
        now: clockOf(deps, ctx).now(),
      });

      if (!claim.claimed) {
        if (claim.action !== command.action || claim.requestHash !== requestHash) {
          throw conflict("This idempotency key was already used for a different request");
        }

        return { result: claim.response as T, events: [] };
      }
    }

    const done = await work(tx);
    const events = done.events ?? [];

    await emit(deps, tx, ctx, events, command.meta.actor);

    if (key) await deps.idempotency.complete(tx, ctx, key, done.result);

    return { result: done.result, events };
  });

  if (outcome.events.length > 0) {
    await deps.pas.apply(ctx, outcome.events, command.meta.actor).catch(() => undefined);
  }

  return outcome.result;
}
