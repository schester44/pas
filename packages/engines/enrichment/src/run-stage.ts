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
  readonly providerId: string;
  readonly capability: ProviderCapability;
  readonly mode: EnrichmentMode;
  readonly request: ProviderRequest;
  readonly response: ProviderResponse;
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

export async function runEnrichmentStage(
  plan: EnrichmentPlan,
  stage: EnrichmentStage,
  risk: EnrichmentRisk,
  deps: EnrichmentDeps,
): Promise<EnrichmentStageResult> {
  const takenAt = deps.clock.now();

  const outcomes = await Promise.all(
    (plan.stages[stage] ?? []).map((call) => executeCall(call, risk, deps)),
  );

  const entries = outcomes.flatMap((outcome) => (outcome.entry ? [outcome.entry] : []));
  const prefills: Prefill[] = [];
  const discrepancies: Discrepancy[] = [];

  for (const entry of entries) {
    const call = plan.stages[stage]!.find((candidate) => candidate.id === entry.callId)!;

    for (const [field, path] of Object.entries(call.response)) {
      const providerValue = entry.response[field];

      if (providerValue === undefined || providerValue === null) continue;

      const attribution = { path, callId: call.id, providerId: entry.providerId, mode: call.mode };

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
    snapshot: { stage, takenAt, entries },
    prefills,
    discrepancies,
    calls: outcomes.flatMap((outcome) => outcome.records),
  };
}

async function executeCall(
  call: EnrichmentCall,
  risk: EnrichmentRisk,
  deps: EnrichmentDeps,
): Promise<{ entry?: SnapshotEntry; records: CallRecord[] }> {
  const request = resolveRequest(call, risk);

  if (!request) return { records: [skipped(call, null, "missing_input")] };

  const records: CallRecord[] = [];

  for (const providerId of call.providers) {
    const provider = deps.providers.get(providerId);

    if (!provider?.manifest.capabilities.includes(call.capability)) {
      records.push(skipped(call, providerId, "unavailable"));
      continue;
    }

    const consent = call.consent ?? (provider.manifest.consumerReport ? "consumer_report" : null);

    if (consent && !risk.consents?.has(consent)) {
      records.push(skipped(call, providerId, "consent_missing"));
      continue;
    }

    const key = `${deps.tenantId}:${enrichmentCacheKey(providerId, call.capability, request)}`;
    const cached = await deps.cache.get(key);

    if (cached) {
      records.push({ ...skipped(call, providerId, "cached"), cost: zeroCost(provider) });

      return { entry: snapshotEntry(call, providerId, request, cached), records };
    }

    if (deps.breaker?.isOpen(providerId)) {
      records.push(skipped(call, providerId, "circuit_open"));
      continue;
    }

    const started = deps.clock.now();

    try {
      const response = await fetchWithTimeout(provider, call, request);

      deps.breaker?.recordSuccess(providerId);

      records.push({
        callId: call.id,
        providerId,
        outcome: "ok",
        latencyMs: elapsedMs(deps.clock, started),
        cost: provider.manifest.costPerCall,
      });

      if (call.cacheTtl) {
        await deps.cache.set(
          key,
          response,
          deps.clock.now().add({ seconds: cacheTtlSeconds(call.cacheTtl) }),
        );
      }

      return { entry: snapshotEntry(call, providerId, request, response), records };
    } catch (error) {
      deps.breaker?.recordFailure(providerId);

      records.push({
        callId: call.id,
        providerId,
        outcome: error instanceof ProviderTimeout ? "timeout" : "error",
        latencyMs: elapsedMs(deps.clock, started),
        cost: provider.manifest.costPerCall,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { records };
}

function resolveRequest(call: EnrichmentCall, risk: EnrichmentRisk): ProviderRequest | null {
  const request: Record<string, unknown> = {};

  for (const [field, path] of Object.entries(call.request)) {
    const value = getAt(risk.data, path);

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

function snapshotEntry(
  call: EnrichmentCall,
  providerId: string,
  request: ProviderRequest,
  response: ProviderResponse,
): SnapshotEntry {
  return {
    callId: call.id,
    providerId,
    capability: call.capability,
    mode: call.mode,
    request,
    response,
  };
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
