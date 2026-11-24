import type { EnrichmentTransform } from "./plan";

export interface TransformInput {
  /** The values the transform `reads`, keyed by source ref. */
  readonly sources: Readonly<Record<string, unknown>>;
  readonly risk: Readonly<Record<string, unknown>>;
}

export type TransformRun =
  | {
      readonly ok: true;
      readonly values: Readonly<Record<string, unknown>>;
      readonly logs: string[];
    }
  | { readonly ok: false; readonly error: string; readonly logs: string[] };

/** Runs a transform's extension (`enrichment_transform`, PLAN §15.1) somewhere sandboxed. */
export interface TransformRunner {
  run(
    transform: EnrichmentTransform,
    input: TransformInput,
    options: { signal: AbortSignal },
  ): Promise<TransformRun>;
}
