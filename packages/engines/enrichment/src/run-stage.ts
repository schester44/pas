import { evaluate } from "@pas/expressions";
import { getAt } from "@pas/forms-core";
import { canonicalJson, type Clock, type Instant, type Money, type TenantId } from "@pas/kernel";
import { enrichmentCacheKey, type EnrichmentCache } from "./cache";
import type { CircuitBreaker } from "./circuit-breaker";
import { cacheTtlSeconds, mappingsOf, stageOfRef } from "./plan";
import type {
  ConsentKind,
  EnrichmentCall,
  EnrichmentMode,
  EnrichmentPlan,
  EnrichmentReport,
  EnrichmentStage,
  EnrichmentTransform,
  ProviderCapability,
} from "./plan";
import type {
  DataProvider,
  ProviderArtifact,
  ProviderRegistry,
  ProviderRequest,
  ProviderResponse,
} from "./provider";
import type { TransformRunner } from "./transform";

/** An answer the PAS already holds, such as a geocode from the address registry. */
export interface KnownResult {
  readonly capability: ProviderCapability;
  /** The risk path it answers for (`locations[0].address`); calls reading under it match. */
  readonly path: string;
  readonly providerId: string;
  readonly response: ProviderResponse;
  /** Skip the call (a rooftop-verified address); otherwise used only when every provider fails. */
  readonly authoritative: boolean;
}

export interface EnrichmentRisk {
  readonly data: Readonly<Record<string, unknown>>;
  /** Paths the user entered or overrode. Enrichment reports on them but never replaces them. */
  readonly userEntered: ReadonlySet<string>;
  readonly consents?: ReadonlySet<ConsentKind>;
  readonly known?: readonly KnownResult[];
  /** Sources from earlier stages, which this stage's transforms, derivations and mappings can read. */
  readonly prior?: EnrichmentSources;
}

export interface EnrichmentDeps {
  readonly tenantId: TenantId;
  readonly providers: ProviderRegistry;
  readonly cache: EnrichmentCache;
  readonly clock: Clock;
  readonly breaker?: CircuitBreaker;
  readonly transforms?: TransformRunner;
}

interface Attribution {
  readonly path: string;
  /** The source ref the value came from (`call.rce.replacementCost`, `derived.coverageA`). */
  readonly source: string;
  /** The provider behind a `call.*` source; null for transforms and derived values. */
  readonly providerId: string | null;
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
  | "missing_input"
  | "known";

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

export type TransformOutcome = "ok" | "error" | "invalid_output" | "unavailable";

export interface TransformRecord {
  readonly transformId: string;
  readonly extension: { readonly key: string; readonly version?: string };
  readonly outcome: TransformOutcome;
  readonly values: Readonly<Record<string, unknown>>;
  readonly logs: readonly string[];
  readonly latencyMs: number;
  readonly error?: string;
}

export interface DerivationError {
  readonly derivationId: string;
  readonly message: string;
}

export interface EnrichmentSnapshot {
  readonly stage: EnrichmentStage;
  readonly takenAt: Instant;
  /** Provider responses exactly as returned (after field mapping in the adapter). */
  readonly entries: readonly SnapshotEntry[];
  readonly transforms: readonly TransformRecord[];
  readonly derived: Readonly<Record<string, unknown>>;
  readonly derivationErrors: readonly DerivationError[];
}

/** Everything a stage produced, addressable by source ref; earlier stages' sources carry forward. */
export interface EnrichmentSources {
  readonly call: Readonly<Record<string, ProviderResponse>>;
  readonly transform: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly derived: Readonly<Record<string, unknown>>;
}

export const emptySources = (): EnrichmentSources => ({ call: {}, transform: {}, derived: {} });

export function sourcesOf(snapshots: readonly EnrichmentSnapshot[]): EnrichmentSources {
  return snapshots.reduce<EnrichmentSources>(
    (sources, snapshot) => ({
      call: {
        ...sources.call,
        ...Object.fromEntries(snapshot.entries.map((entry) => [entry.callId, entry.response])),
      },
      transform: {
        ...sources.transform,
        ...Object.fromEntries(
          snapshot.transforms
            .filter((t) => t.outcome === "ok")
            .map((t) => [t.transformId, t.values]),
        ),
      },
      derived: { ...sources.derived, ...snapshot.derived },
    }),
    emptySources(),
  );
}

export type ReportOutcome =
  | {
      readonly reportId: string;
      readonly title: string;
      readonly source: "vendor";
      readonly providerId: string;
      readonly artifact: ProviderArtifact;
    }
  | {
      readonly reportId: string;
      readonly title: string;
      readonly source: "template";
      readonly template: string;
    }
  | {
      readonly reportId: string;
      readonly title: string;
      readonly source: null;
      readonly reason: string;
    };

export interface EnrichmentStageResult {
  readonly snapshot: EnrichmentSnapshot;
  /** This stage's sources merged over the prior ones. */
  readonly sources: EnrichmentSources;
  readonly prefills: readonly Prefill[];
  readonly discrepancies: readonly Discrepancy[];
  readonly calls: readonly CallRecord[];
  readonly reports: readonly ReportOutcome[];
  /** A transform with `onFailure: "block"` failed; the caller must not use this enrichment. */
  readonly blocked?: { readonly transformId: string; readonly message: string };
}

class ProviderTimeout extends Error {}

/**
 * Runs a stage (PLAN §11.1). Independent calls run in parallel; a call waits for the calls it
 * `dependsOn` and reads their results (a geocode before hazards). Each call falls back through
 * its providers, or with `merge` asks them all and merges field by field, recording provenance.
 * Then the stage's transforms (sandboxed extensions) and derivations (expressions) run in order,
 * and mappings from any source ref write onto the risk.
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

  const entries = outcomes.flatMap((outcome) => (outcome.entry ? [outcome.entry] : []));
  const prior = risk.prior ?? emptySources();

  const sources = {
    call: { ...prior.call, ...Object.fromEntries(entries.map((e) => [e.callId, e.response])) },
    transform: { ...prior.transform },
    derived: { ...prior.derived },
  };

  const transforms: TransformRecord[] = [];
  let blocked: EnrichmentStageResult["blocked"];

  for (const transform of plan.transforms.filter((t) => t.stage === stage)) {
    const record = await runTransform(transform, sources, risk, deps);
    transforms.push(record);

    if (record.outcome === "ok") {
      sources.transform[transform.id] = record.values;
    } else if (transform.onFailure === "block" && !blocked) {
      blocked = { transformId: transform.id, message: record.error ?? record.outcome };
    }
  }

  const derivedNow: Record<string, unknown> = {};
  const derivationErrors: DerivationError[] = [];

  for (const derivation of plan.derivations.filter((d) => d.stage === stage)) {
    try {
      const value = evaluate(derivation.expression, { ...sources, risk: risk.data });

      if (value !== undefined) {
        derivedNow[derivation.id] = value;
        sources.derived[derivation.id] = value;
      }
    } catch (error) {
      derivationErrors.push({
        derivationId: derivation.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const providerOf = (ref: string): string | null => {
    const [kind, callId, field] = ref.split(".");

    if (kind !== "call") return null;

    const entry = entries.find((e) => e.callId === callId);

    return (field && entry?.provenance[field]) ?? entry?.providerId ?? null;
  };

  const prefills: Prefill[] = [];
  const discrepancies: Discrepancy[] = [];

  for (const mapping of mappingsOf(plan)) {
    if (stageOfRef(plan, mapping.from) !== stage) continue;

    const providerValue = getAt(sources, mapping.from);

    if (isBlank(providerValue)) continue;

    const attribution = {
      path: mapping.to,
      source: mapping.from,
      providerId: providerOf(mapping.from),
      mode: mapping.mode,
    };

    if (risk.userEntered.has(mapping.to)) {
      const userValue = getAt(risk.data, mapping.to);

      if (!isBlank(userValue) && !sameValue(userValue, providerValue)) {
        discrepancies.push({ ...attribution, userValue, providerValue });
      }
    } else if (mapping.mode !== "uw_only") {
      prefills.push({ ...attribution, value: providerValue });
    }
  }

  const reports = await Promise.all(
    plan.reports
      .filter((report) => report.stage === stage)
      .map((report) => resolveReport(report, calls, entries, deps)),
  );

  return {
    snapshot: { stage, takenAt, entries, transforms, derived: derivedNow, derivationErrors },
    sources,
    prefills,
    discrepancies,
    calls: outcomes.flatMap((outcome) => outcome.records),
    reports,
    ...(blocked && { blocked }),
  };
}

async function runTransform(
  transform: EnrichmentTransform,
  sources: EnrichmentSources,
  risk: EnrichmentRisk,
  deps: EnrichmentDeps,
): Promise<TransformRecord> {
  const base = { transformId: transform.id, extension: transform.extension, values: {}, logs: [] };

  if (!deps.transforms) {
    return {
      ...base,
      outcome: "unavailable",
      latencyMs: 0,
      error: "No extension runtime is configured",
    };
  }

  const input = {
    sources: Object.fromEntries(transform.reads.map((ref) => [ref, getAt(sources, ref) ?? null])),
    risk: risk.data,
  };

  const started = deps.clock.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), transform.timeoutMs);

  try {
    const run = await deps.transforms.run(transform, input, { signal: controller.signal });
    const latencyMs = elapsedMs(deps.clock, started);

    if (!run.ok) return { ...base, outcome: "error", logs: run.logs, latencyMs, error: run.error };

    const unexpected = Object.keys(run.values).filter((field) => !transform.writes.includes(field));

    if (unexpected.length > 0) {
      return {
        ...base,
        outcome: "invalid_output",
        logs: run.logs,
        latencyMs,
        error: `Returned fields it doesn't declare: ${unexpected.join(", ")}`,
      };
    }

    return { ...base, outcome: "ok", values: run.values, logs: run.logs, latencyMs };
  } catch (error) {
    return {
      ...base,
      outcome: "error",
      latencyMs: elapsedMs(deps.clock, started),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveReport(
  report: EnrichmentReport,
  calls: readonly EnrichmentCall[],
  entries: readonly SnapshotEntry[],
  deps: EnrichmentDeps,
): Promise<ReportOutcome> {
  const base = { reportId: report.id, title: report.title };
  let reason = "No report source";

  if (report.source !== "template") {
    const entry = entries.find((e) => e.callId === report.callId);
    const provider = entry && deps.providers.get(entry.providerId);
    const call = calls.find((c) => c.id === report.callId);

    if (!entry || !call) {
      reason = "The call didn't return data";
    } else if (!provider?.report) {
      reason = `${entry.providerId} doesn't supply reports`;
    } else {
      try {
        const artifact = await withTimeout(
          (signal) => provider.report!(call.capability, entry.request, entry.response, { signal }),
          call.timeoutMs,
          `${entry.providerId} report timed out after ${call.timeoutMs}ms`,
        );

        if (artifact) {
          return { ...base, source: "vendor", providerId: entry.providerId, artifact };
        }

        reason = `${entry.providerId} returned no report`;
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
    }
  }

  if (report.source !== "vendor" && report.template) {
    return { ...base, source: "template", template: report.template };
  }

  return { ...base, source: null, reason };
}

type Attempt = { providerId: string; response?: ProviderResponse; record: CallRecord };

async function executeCall(
  call: EnrichmentCall,
  risk: EnrichmentRisk,
  derived: ReadonlyMap<string, unknown>,
  deps: EnrichmentDeps,
): Promise<{ entry?: SnapshotEntry; records: CallRecord[] }> {
  const known = knownFor(call, risk);
  const request = resolveRequest(call, risk, derived);

  if (known?.authoritative) return answeredByKnown(call, request ?? {}, known);

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

    if (known) attempts.push(knownAttempt(call, known));

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

  if (known) {
    const fallback = knownAttempt(call, known);

    return { entry: merged(call, request, [fallback]), records: [...records, fallback.record] };
  }

  return { records };
}

function knownFor(call: EnrichmentCall, risk: EnrichmentRisk): KnownResult | undefined {
  const paths = Object.values(call.request);

  return risk.known?.find(
    (k) =>
      k.capability === call.capability &&
      paths.some((path) => path === k.path || path.startsWith(`${k.path}.`)),
  );
}

function knownAttempt(call: EnrichmentCall, known: KnownResult): Attempt {
  return {
    providerId: known.providerId,
    response: known.response,
    record: skipped(call, known.providerId, "known"),
  };
}

function answeredByKnown(call: EnrichmentCall, request: ProviderRequest, known: KnownResult) {
  const answer = knownAttempt(call, known);

  return { entry: merged(call, request, [answer]), records: [answer.record] };
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

    if (isBlank(value)) {
      if (call.optional.includes(field)) continue;

      return null;
    }

    request[field] = value;
  }

  return request;
}

function fetchWithTimeout(
  provider: DataProvider,
  call: EnrichmentCall,
  request: ProviderRequest,
): Promise<ProviderResponse> {
  return withTimeout(
    (signal) => provider.fetch(call.capability, request, { signal }),
    call.timeoutMs,
    `${provider.manifest.id} timed out after ${call.timeoutMs}ms`,
  );
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Raced as well as signalled, so a provider that ignores the signal still can't stall the stage.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new ProviderTimeout(message);

      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([run(controller.signal), timeout]);
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
