import { referencedPaths } from "@pas/expressions";
import {
  CAPABILITY_FIELDS,
  type EnrichmentPlan,
  enrichmentStages,
  type EnrichmentStage,
  enrichmentSchema,
  stageOfRef,
} from "@pas/enrichment";
import { canonicalPath, indexSchema, resolvesInSchema } from "@pas/forms-core";
import type { VersionContents } from "./version-contents";

export type EnrichmentSection = "calls" | "transforms" | "derivations" | "mappings" | "reports";

export interface EnrichmentTarget {
  section?: EnrichmentSection;
  /** The call, transform, derivation or report id, or the mapping's index. */
  item?: string;
  property?: string;
}

export interface EnrichmentIssue {
  severity: "error" | "warning";
  message: string;
  target: EnrichmentTarget;
}

/** What the tenant has: enabled data providers and installed `enrichment_transform` extensions. */
export interface EnrichmentReferences {
  providers?: readonly { id: string; capabilities: readonly string[] }[];
  extensions?: ReadonlyMap<string, { version: string; writes?: readonly string[] } | null>;
}

const order = (stage: EnrichmentStage) => enrichmentStages.indexOf(stage);

/** Static checks of a version's enrichment plan against its risk schema and documents (PLAN §11.1). */
export function checkEnrichment(
  contents: VersionContents,
  references: EnrichmentReferences = {},
): EnrichmentIssue[] {
  const plan = contents.enrichment;
  const issues: EnrichmentIssue[] = [];

  const error = (target: EnrichmentTarget, message: string) =>
    issues.push({ severity: "error", target, message });

  const warn = (target: EnrichmentTarget, message: string) =>
    issues.push({ severity: "warning", target, message });

  const risk = indexSchema(contents.riskSchema);
  const sources = indexSchema({ fields: enrichmentSchema(plan).children });
  const ids = new Set<string>();

  const unique = (section: EnrichmentSection, id: string) => {
    if (ids.has(id)) error({ section, item: id }, `${id} is used more than once`);

    ids.add(id);
  };

  /** A source ref must exist, and its stage must run no later than the stage reading it. */
  const readable = (ref: string, stage: EnrichmentStage | null, target: EnrichmentTarget) => {
    const from = stageOfRef(plan, ref);

    if (!from) return error(target, `Nothing in the plan produces ${ref}`);

    if (stage && order(from) > order(stage)) {
      return error(target, `${ref} comes from ${from}, after ${stage}`);
    }

    if (!ref.startsWith("transform.") && !resolvesInSchema(sources, canonicalPath(ref))) {
      error(target, `${ref} isn't a field this source supplies`);
    }
  };

  for (const stage of enrichmentStages) {
    for (const call of plan.stages[stage] ?? []) {
      const target = { section: "calls" as const, item: call.id };
      unique("calls", call.id);

      for (const path of Object.values(call.request)) {
        if (!resolvesInSchema(risk, canonicalPath(path))) {
          error({ ...target, property: "request" }, `Unknown risk path ${path}`);
        }
      }

      for (const field of Object.keys(call.response)) {
        if (!CAPABILITY_FIELDS[call.capability].some((node) => node.key === field)) {
          error({ ...target, property: "response" }, `${call.capability} has no field ${field}`);
        }
      }

      if (references.providers) {
        for (const id of call.providers) {
          const provider = references.providers.find((p) => p.id === id);

          if (!provider) warn({ ...target, property: "providers" }, `${id} isn't enabled`);
          else if (!provider.capabilities.includes(call.capability)) {
            error({ ...target, property: "providers" }, `${id} doesn't supply ${call.capability}`);
          }
        }
      }
    }
  }

  for (const transform of plan.transforms) {
    const target = { section: "transforms" as const, item: transform.id };
    unique("transforms", transform.id);

    transform.reads.forEach((ref) =>
      readable(ref, transform.stage, { ...target, property: "reads" }),
    );

    const installed = references.extensions?.get(transform.extension.key);

    if (references.extensions && !installed) {
      error(
        { ...target, property: "extension" },
        `No enrichment transform extension ${transform.extension.key} is installed`,
      );
    } else if (installed?.writes) {
      for (const field of transform.writes.filter((w) => !installed.writes!.includes(w))) {
        error(
          { ...target, property: "writes" },
          `${transform.extension.key} doesn't write ${field}`,
        );
      }
    }
  }

  const derived = new Set<string>();

  for (const derivation of plan.derivations) {
    const target = { section: "derivations" as const, item: derivation.id };
    unique("derivations", derivation.id);

    try {
      for (const path of referencedPaths(derivation.expression)) {
        const [root] = path.split(".");

        if (root === "risk") {
          if (!resolvesInSchema(risk, canonicalPath(path.slice("risk.".length)))) {
            error({ ...target, property: "expression" }, `Unknown risk path ${path}`);
          }
        } else if (root === "derived" && !derived.has(path.split(".")[1] ?? "")) {
          error(
            { ...target, property: "expression" },
            `${path} isn't derived before ${derivation.id}`,
          );
        } else if (root === "call" || root === "transform") {
          readable(path, derivation.stage, { ...target, property: "expression" });
        } else if (root !== "derived") {
          error({ ...target, property: "expression" }, `Unknown value ${path}`);
        }
      }
    } catch (failure) {
      error(
        { ...target, property: "expression" },
        failure instanceof Error ? failure.message : "The expression doesn't parse",
      );
    }

    derived.add(derivation.id);
  }

  plan.mappings.forEach((mapping, index) => {
    const target = { section: "mappings" as const, item: String(index) };
    readable(mapping.from, null, { ...target, property: "from" });

    if (!resolvesInSchema(risk, canonicalPath(mapping.to))) {
      error({ ...target, property: "to" }, `Unknown risk path ${mapping.to}`);
    }
  });

  for (const report of plan.reports) {
    const target = { section: "reports" as const, item: report.id };
    unique("reports", report.id);

    if (report.source !== "template" && !callExists(plan, report.callId)) {
      error(
        { ...target, property: "callId" },
        "Choose the call whose provider supplies the report",
      );
    }

    if (report.source !== "vendor") {
      const template = contents.documents.templates.find((t) => t.key === report.template);

      if (!template) error({ ...target, property: "template" }, "Choose a report template");
      else if (template.kind !== "enrichment_report") {
        error({ ...target, property: "template" }, `${template.title} isn't an enrichment report`);
      }
    }
  }

  return issues;
}

function callExists(plan: EnrichmentPlan, id: string | undefined): boolean {
  return enrichmentStages.some((stage) => plan.stages[stage]?.some((call) => call.id === id));
}

/** The plan with each transform pinned to the extension version installed at publish. */
export function pinExtensions(
  plan: EnrichmentPlan,
  extensions: ReadonlyMap<string, { version: string } | null>,
): EnrichmentPlan {
  return {
    ...plan,
    transforms: plan.transforms.map((transform) => ({
      ...transform,
      extension: {
        ...transform.extension,
        version: transform.extension.version ?? extensions.get(transform.extension.key)?.version,
      },
    })),
  };
}
