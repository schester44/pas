import { getAt } from "@pas/forms-core";
import { canonicalJson, type Clock, type Instant, type Money, type TenantId } from "@pas/kernel";
import { enrichmentCacheKey, type EnrichmentCache } from "./cache";
import type { CircuitBreaker } from "./circuit-breaker";
import { cacheTtlSeconds } from "./plan";
import type {
  ConsentKind,
  EnrichmentCall,
  EnrichmentMode,
  EnrichmentPlan,
  EnrichmentStage,
  ProviderCapability,
} from "./plan";
import type { DataProvider, ProviderRegistry, ProviderRequest, ProviderResponse } from "./provider";

export interface EnrichmentRisk {
  readonly data: Readonly<Record<string, unknown>>;
  /** Paths the user entered or overrode. Enrichment reports on them but never replaces them. */
  readonly userEntered: ReadonlySet<string>;
  readonly consents?: ReadonlySet<ConsentKind>;
}

export interface EnrichmentDeps {
  readonly tenantId: TenantId;
  readonly providers: ProviderRegistry;
  readonly cache: EnrichmentCache;
  readonly clock: Clock;
  readonly breaker?: CircuitBreaker;
}

interface Attribution {
  readonly path: string;
  readonly callId: string;
  readonly providerId: string;
  readonly mode: EnrichmentMode;
}

export interface Prefill extends Attribution {
  readonly value: unknown;
}

export interface Discrepancy extends Attribution {
  readonly userValue: unknown;
  readonly providerValue: unknown;
}

export type CallOutcome =
  | "ok"
  | "cached"
  | "error"
  | "timeout"
  | "circuit_open"
  | "unavailable"
  | "consent_missing"
  | "missing_input";

export interface CallRecord {
  readonly callId: string;
  readonly providerId: string | null;
  readonly outcome: CallOutcome;
  readonly latencyMs: number;
  readonly cost: Money | null;
  readonly error?: string;
}

export interface SnapshotEntry {
  readonly callId: string;
  /** The provider that supplied most fields; `provenance` has the per-field source. */
  readonly providerId: string;
  readonly capability: ProviderCapability;
  readonly mode: EnrichmentMode;
  readonly request: ProviderRequest;
  readonly response: ProviderResponse;
  readonly provenance: Readonly<Record<string, string>>;
}

export interface EnrichmentSnapshot {
  readonly stage: EnrichmentStage;
  readonly takenAt: Instant;
  readonly entries: readonly SnapshotEntry[];
}

export interface EnrichmentStageResult {
  readonly snapshot: EnrichmentSnapshot;
  readonly prefills: readonly Prefill[];
  readonly discrepancies: readonly Discrepancy[];
  readonly calls: readonly CallRecord[];
}

class ProviderTimeout extends Error {}

/**
 * Runs a stage's calls (PLAN §11.1). Independent calls run in parallel; a call waits for the calls
 * it `dependsOn` and reads their results (a geocode before hazards). Each call falls back through
 * its providers, or with `merge` asks them all and merges field by field, recording provenance.
 */
export async function runEnrichmentStage(
  plan: EnrichmentPlan,
  stage: EnrichmentStage,
  risk: EnrichmentRisk,
  deps: EnrichmentDeps,
): Promise<EnrichmentStageResult> {
  const takenAt = deps.clock.now();
  const calls = plan.stages[stage] ?? [];
  const derived = new Map<string, unknown>();
  const done = new Set<string>();
  const outcomes: { call: EnrichmentCall; entry?: SnapshotEntry; records: CallRecord[] }[] = [];

  while (done.size < calls.length) {
    const ready = calls.filter(
      (call) => !done.has(call.id) && call.dependsOn.every((id) => done.has(id)),
    );

    if (ready.length === 0) throw new Error(`Enrichment calls in ${stage} depend on each other`);

    const wave = await Promise.all(
      ready.map(async (call) => ({ call, ...(await executeCall(call, risk, derived, deps)) })),
    );

    for (const outcome of wave) {
      done.add(outcome.call.id);
      outcomes.push(outcome);

      for (const [field, path] of Object.entries(outcome.call.response)) {
        const value = outcome.entry?.response[field];

        if (!isBlank(value) && !risk.userEntered.has(path)) derived.set(path, value);
      }
    }
  }

  const order = new Map(calls.map((call, index) => [call.id, index]));
  outcomes.sort((a, b) => order.get(a.call.id)! - order.get(b.call.id)!);

  const prefills: Prefill[] = [];
  const discrepancies: Discrepancy[] = [];

  for (const { call, entry } of outcomes) {
    if (!entry) continue;

    for (const [field, path] of Object.entries(call.response)) {
      const providerValue = entry.response[field];

      if (providerValue === undefined || providerValue === null) continue;

      const attribution = {
        path,
        callId: call.id,
        providerId: entry.provenance[field] ?? entry.providerId,
        mode: call.mode,
      };

      if (risk.userEntered.has(path)) {
        const userValue = getAt(risk.data, path);

        if (!isBlank(userValue) && !sameValue(userValue, providerValue)) {
          discrepancies.push({ ...attribution, userValue, providerValue });
        }
      } else if (call.mode !== "uw_only") {
        prefills.push({ ...attribution, value: providerValue });
      }
    }
  }

  return {
    snapshot: {
      stage,
      takenAt,
      entries: outcomes.flatMap((outcome) => (outcome.entry ? [outcome.entry] : [])),
    },
    prefills,
    discrepancies,
    calls: outcomes.flatMap((outcome) => outcome.records),
  };
}

type Attempt = { providerId: string; response?: ProviderResponse; record: CallRecord };

async function executeCall(
  call: EnrichmentCall,
  risk: EnrichmentRisk,
  derived: ReadonlyMap<string, unknown>,
  deps: EnrichmentDeps,
): Promise<{ entry?: SnapshotEntry; records: CallRecord[] }> {
  const request = resolveRequest(call, risk, derived);

  if (!request) return { records: [skipped(call, null, "missing_input")] };

  if (call.combine === "merge") {
    const resolved = new Set<string>();

    const distinct = call.providers.filter((id) => {
      const actual = deps.providers.get(id)?.manifest.id ?? id;
      const fresh = !resolved.has(actual);
      resolved.add(actual);

      return fresh;
    });

    const attempts = await Promise.all(
      distinct.map((providerId) => attempt(call, providerId, request, risk, deps)),
    );

    return { entry: merged(call, request, attempts), records: attempts.map((a) => a.record) };
  }

  const records: CallRecord[] = [];

  for (const providerId of call.providers) {
    const result = await attempt(call, providerId, request, risk, deps);
    records.push(result.record);

    if (result.response) {
      return { entry: merged(call, request, [result]), records };
    }
  }

  return { records };
}

/** First non-empty value per field in provider order, unless `fieldSources` names the winner. */
export function merged(
  call: EnrichmentCall,
  request: ProviderRequest,
  attempts: readonly Attempt[],
): SnapshotEntry | undefined {
  const answered = attempts.filter((a) => a.response);

  if (answered.length === 0) return undefined;

  const response: Record<string, unknown> = {};
  const provenance: Record<string, string> = {};
  const fields = new Set(answered.flatMap((a) => Object.keys(a.response!)));

  for (const field of fields) {
    const preferred = call.fieldSources[field];

    const source =
      answered.find((a) => a.providerId === preferred && !isBlank(a.response![field])) ??
      answered.find((a) => !isBlank(a.response![field]));

    if (!source) continue;

    response[field] = source.response![field];
    provenance[field] = source.providerId;
  }

  const counts = Object.values(provenance).reduce(
    (tally, id) => tally.set(id, (tally.get(id) ?? 0) + 1),
    new Map<string, number>(),
  );

  const primary = answered.toSorted(
    (a, b) => (counts.get(b.providerId) ?? 0) - (counts.get(a.providerId) ?? 0),
  )[0]!;

  return {
    callId: call.id,
    providerId: primary.providerId,
    capability: call.capability,
    mode: call.mode,
    request,
    response,
    provenance,
  };
}

async function attempt(
  call: EnrichmentCall,
  requested: string,
  request: ProviderRequest,
  risk: EnrichmentRisk,
  deps: EnrichmentDeps,
): Promise<Attempt> {
  const provider = deps.providers.get(requested);

  if (!provider?.manifest.capabilities.includes(call.capability)) {
    return { providerId: requested, record: skipped(call, requested, "unavailable") };
  }

  // Sandboxes alias real providers to fakes; provenance names what actually answered.
  const providerId = provider.manifest.id;
  const consent = call.consent ?? (provider.manifest.consumerReport ? "consumer_report" : null);

  if (consent && !risk.consents?.has(consent)) {
    return { providerId, record: skipped(call, providerId, "consent_missing") };
  }

  const key = `${deps.tenantId}:${enrichmentCacheKey(providerId, call.capability, request)}`;
  const cached = await deps.cache.get(key);

  if (cached) {
    return {
      providerId,
      response: cached,
      record: { ...skipped(call, providerId, "cached"), cost: zeroCost(provider) },
    };
  }

  if (deps.breaker?.isOpen(providerId)) {
    return { providerId, record: skipped(call, providerId, "circuit_open") };
  }

  const started = deps.clock.now();

  try {
    const response = await fetchWithTimeout(provider, call, request);

    deps.breaker?.recordSuccess(providerId);

    if (call.cacheTtl) {
      await deps.cache.set(
        key,
        response,
        deps.clock.now().add({ seconds: cacheTtlSeconds(call.cacheTtl) }),
      );
    }

    return {
      providerId,
      response,
      record: {
        callId: call.id,
        providerId,
        outcome: "ok",
        latencyMs: elapsedMs(deps.clock, started),
        cost: provider.manifest.costPerCall,
      },
    };
  } catch (error) {
    deps.breaker?.recordFailure(providerId);

    return {
      providerId,
      record: {
        callId: call.id,
        providerId,
        outcome: error instanceof ProviderTimeout ? "timeout" : "error",
        latencyMs: elapsedMs(deps.clock, started),
        cost: provider.manifest.costPerCall,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function resolveRequest(
  call: EnrichmentCall,
  risk: EnrichmentRisk,
  derived: ReadonlyMap<string, unknown>,
): ProviderRequest | null {
  const request: Record<string, unknown> = {};

  for (const [field, path] of Object.entries(call.request)) {
    const entered = getAt(risk.data, path);
    const value = isBlank(entered) ? derived.get(path) : entered;

    if (isBlank(value)) return null;

    request[field] = value;
  }

  return request;
}

async function fetchWithTimeout(
  provider: DataProvider,
  call: EnrichmentCall,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Raced as well as signalled, so a provider that ignores the signal still can't stall the stage.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new ProviderTimeout(
        `${provider.manifest.id} timed out after ${call.timeoutMs}ms`,
      );

      controller.abort(error);
      reject(error);
    }, call.timeoutMs);
  });

  try {
    return await Promise.race([
      provider.fetch(call.capability, request, { signal: controller.signal }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function skipped(
  call: EnrichmentCall,
  providerId: string | null,
  outcome: CallOutcome,
): CallRecord {
  return { callId: call.id, providerId, outcome, latencyMs: 0, cost: null };
}

function zeroCost(provider: DataProvider): Money {
  return provider.manifest.costPerCall.times(0);
}

function elapsedMs(clock: Clock, started: Instant): number {
  return started.until(clock.now()).total("milliseconds");
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

const normalizeForComparison = (value: unknown) =>
  typeof value === "string" ? value.trim().toUpperCase() : value;

function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(normalizeForComparison(a)) === canonicalJson(normalizeForComparison(b));
}
