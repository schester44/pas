import { evaluate, referencedPaths } from "@pas/expressions";
import { expressionData, schemaIndex } from "./evaluate";
import { canonicalPath, getAt, joinPath, rowIdOf, rowPath } from "./paths";
import {
  type Endorsable,
  type EndorsableRule,
  type RepeatableNode,
  resolvesInSchema,
  type RiskSchema,
  type SchemaNode,
} from "./schema";

/** What an endorsable condition can read besides the risk (`$item` is the row being changed). */
export interface EndorsementContext {
  transaction: { effectiveDate: string };
  term: { effectiveDate: string; expirationDate: string };
  actor: { roles: readonly string[] };
}

export type Permit = { ok: true } | { ok: false; reason: string };

const CONTEXT_PATHS = new Set([
  "transaction",
  "transaction.effectiveDate",
  "term",
  "term.effectiveDate",
  "term.expirationDate",
  "actor",
  "actor.role",
  "actor.roles",
]);

const ALLOWED: Permit = { ok: true };

const roleList = (roles: readonly string[]) =>
  new Intl.ListFormat("en-US", { type: "disjunction" }).format(
    roles.map((role) => role.replaceAll("_", " ")),
  );

export const isConditional = (rule: Endorsable | undefined): rule is EndorsableRule =>
  typeof rule === "object" && rule !== null;

/**
 * Evaluates a field's or a repeatable's `endorsable` against the issued risk, the change and the
 * actor. A condition that can't be evaluated doesn't allow the change.
 */
export function endorsePermit(
  schema: RiskSchema,
  rule: Endorsable | undefined,
  risk: Record<string, unknown>,
  context: EndorsementContext,
  item?: { repeatable: RepeatableNode; row: unknown },
): Permit {
  if (rule === true) return ALLOWED;

  if (!isConditional(rule)) return { ok: false, reason: "Can't change by endorsement" };

  if (rule.roles?.length && !rule.roles.some((role) => context.actor.roles.includes(role))) {
    return { ok: false, reason: rule.reason ?? `Only ${roleList(rule.roles)} can change this` };
  }

  if (!rule.when) return ALLOWED;

  const data = {
    ...expressionData(schema.fields, risk),
    transaction: context.transaction,
    term: context.term,
    actor: { role: context.actor.roles[0] ?? null, roles: [...context.actor.roles] },
    ...(item && { $item: expressionData(item.repeatable.children, item.row) }),
  };

  let holds = false;

  try {
    holds = evaluate(rule.when, data) === true;
  } catch {
    holds = false;
  }

  return holds ? ALLOWED : { ok: false, reason: rule.reason ?? "Can't change on this endorsement" };
}

export interface EndorsableIssue {
  path: string;
  message: string;
}

/** Publish check: every endorsable condition parses and reads only the risk and its context. */
export function checkEndorsableRules(schema: RiskSchema): EndorsableIssue[] {
  const index = schemaIndex(schema);
  const issues: EndorsableIssue[] = [];

  const check = (rule: Endorsable | undefined, path: string, repeat: string | null) => {
    if (!isConditional(rule)) return;

    if (rule.roles && rule.roles.length === 0) {
      issues.push({ path, message: "List at least one role, or remove the role limit" });
    }

    if (!rule.when) return;

    let paths: string[];

    try {
      paths = referencedPaths(rule.when, {
        aliases: repeat ? { $item: `${repeat}[]`, $index: null } : {},
      });
    } catch (error) {
      issues.push({ path, message: `Endorsable condition: ${(error as Error).message}` });

      return;
    }

    for (const p of paths) {
      if (!CONTEXT_PATHS.has(p) && !resolvesInSchema(index, p)) {
        issues.push({ path, message: `Endorsable condition reads ${p}, which doesn't exist` });
      }
    }
  };

  const walk = (nodes: SchemaNode[], base: string, repeat: string | null) => {
    for (const node of nodes) {
      const path = joinPath(base, node.key);

      if (node.kind === "group") walk(node.children, path, repeat);
      else if (node.kind === "repeatable") {
        check(node.endorsable, path, repeat);
        walk(node.children, `${path}[]`, path);
      } else check(node.endorsable, path, repeat);
    }
  };

  walk(schema.fields, "", null);

  return issues;
}

/**
 * What the endorsement form may change, for the form as it's being edited: rows added in this
 * change are new data and fully editable; issued rows and fields follow their `endorsable`.
 */
export function endorsementEditability(
  schema: RiskSchema,
  issued: Record<string, unknown>,
  value: Record<string, unknown>,
  context: EndorsementContext,
): { field: (path: string) => string | null; rows: (repeat: string) => boolean } {
  const index = schemaIndex(schema);

  return {
    field(path) {
      const node = index.get(canonicalPath(path));

      if (!node || node.kind === "group" || node.kind === "repeatable") return null;

      const row = /^(.*?\[\d+\])\./.exec(path)?.[1];

      if (!row) {
        const permit = endorsePermit(schema, node.endorsable, issued, context);

        return permit.ok ? null : permit.reason;
      }

      const repeatable = index.get(canonicalPath(row.replace(/\[\d+\]$/, "")));
      const id = rowIdOf(getAt(value, row));
      const issuedRow = id ? getAt(issued, rowPath(row.replace(/\[\d+\]$/, ""), id)) : undefined;

      if (!issuedRow || repeatable?.kind !== "repeatable") return null;

      const permit = endorsePermit(schema, node.endorsable, issued, context, {
        repeatable,
        row: issuedRow,
      });

      return permit.ok ? null : permit.reason;
    },
    rows(repeat) {
      const node = index.get(canonicalPath(repeat));

      return (
        node?.kind === "repeatable" && endorsePermit(schema, node.endorsable, issued, context).ok
      );
    },
  };
}
