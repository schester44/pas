import { createScope, type ExpressionScope } from "@pas/expressions";
import { DecisionError } from "./errors";
import {
  type DecisionTableContent,
  type ExpressionContent,
  type JdmDecision,
  type JdmEdge,
  type JdmGraph,
  type JdmNode,
  jdmSchema,
  ruleCell,
  SUPPORTED_NODE_TYPES,
  type SwitchContent,
} from "./jdm";

export interface CompiledDecision {
  readonly graph: JdmGraph;
  readonly order: readonly JdmNode[];
  readonly incoming: ReadonlyMap<string, readonly JdmEdge[]>;
}

export interface MatchedRule {
  index: number;
  ruleId: string;
  description?: string;
  reference_map: Record<string, unknown>;
}

export interface NodeTrace {
  id: string;
  name: string;
  type: JdmNode["type"];
  input: unknown;
  output: unknown;
  performance: string;
  traceData?: MatchedRule | MatchedRule[] | { statements: { id: string }[] } | null;
}

export type DecisionTrace = Record<string, NodeTrace>;

type Json = unknown;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseJdm(artifact: unknown): JdmGraph {
  const parsed = jdmSchema.safeParse(artifact);

  if (!parsed.success) {
    throw new DecisionError("invalid_jdm", "The decision isn't a valid JDM graph", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  return parsed.data;
}

export function topologicalOrder(graph: JdmGraph): JdmNode[] | undefined {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));

  for (const edge of graph.edges) {
    if (byId.has(edge.sourceId) && byId.has(edge.targetId)) {
      indegree.set(edge.targetId, (indegree.get(edge.targetId) ?? 0) + 1);
    }
  }

  const queue = graph.nodes.filter((node) => indegree.get(node.id) === 0);
  const order: JdmNode[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);

    for (const edge of graph.edges) {
      if (edge.sourceId !== node.id || !byId.has(edge.targetId)) continue;

      const remaining = indegree.get(edge.targetId)! - 1;
      indegree.set(edge.targetId, remaining);

      if (remaining === 0) queue.push(byId.get(edge.targetId)!);
    }
  }

  return order.length === graph.nodes.length ? order : undefined;
}

const MAX_CACHED = 500;
const cache = new Map<string, CompiledDecision>();

export function compileDecision(
  artifact: JdmDecision,
  options: { cacheKey?: string } = {},
): CompiledDecision {
  const key = options.cacheKey;
  const cached = key === undefined ? undefined : cache.get(key);

  if (cached) return cached;

  const graph = parseJdm(artifact);

  const unsupported = graph.nodes.find(
    (node) => !(SUPPORTED_NODE_TYPES as readonly string[]).includes(node.type),
  );

  if (unsupported) {
    throw new DecisionError(
      "unsupported_node",
      `${unsupported.name || unsupported.type} uses a node type the engine doesn't run`,
      { nodeId: unsupported.id, type: unsupported.type },
    );
  }

  const order = topologicalOrder(graph);

  if (!order) throw new DecisionError("invalid_jdm", "The decision graph has a cycle");

  const incoming = new Map<string, JdmEdge[]>();

  for (const edge of graph.edges) {
    incoming.set(edge.targetId, [...(incoming.get(edge.targetId) ?? []), edge]);
  }

  const compiled: CompiledDecision = { graph, order, incoming };

  if (key !== undefined) {
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);

    cache.set(key, compiled);
  }

  return compiled;
}

function merge(target: Json, source: Json): Json {
  if (!isRecord(target) || !isRecord(source)) return source;

  const out: Record<string, unknown> = { ...target };

  for (const [key, value] of Object.entries(source)) out[key] = merge(out[key], value);

  return out;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let current = target;

  for (const key of keys.slice(0, -1)) {
    if (!isRecord(current[key])) current[key] = {};

    current = current[key] as Record<string, unknown>;
  }

  current[keys.at(-1)!] = value;
}

function withScope<T>(context: Json, run: (scope: ExpressionScope) => T): T {
  const scope = createScope(isRecord(context) ? context : {});

  try {
    return run(scope);
  } finally {
    scope.dispose();
  }
}

function failed(node: JdmNode, error: unknown, details: Record<string, unknown> = {}): never {
  const message = error instanceof Error ? error.message : String(error);

  throw new DecisionError("evaluation_failed", `${node.name || node.id}: ${message}`, {
    nodeId: node.id,
    ...details,
  });
}

// ZEN treats a cell that can't be evaluated (e.g. `> 20` against a missing value) as not matching.
function matches(scope: ExpressionScope, cell: string, unary: boolean): boolean {
  try {
    return unary ? scope.evaluateUnary(cell) : Boolean(scope.evaluate(cell));
  } catch {
    return false;
  }
}

function runTable(node: JdmNode, content: DecisionTableContent, context: Json) {
  return withScope(context, (scope) => {
    const columns = content.inputs.map((column) => {
      const field = column.field?.trim();

      if (!field) return { column, scope, value: undefined, unary: false };

      let value: unknown;

      try {
        value = scope.evaluate(field);
      } catch {
        value = null;
      }

      return { column, scope: scope.with("$", value), value, unary: true };
    });

    try {
      const hits: { output: Record<string, unknown>; trace: MatchedRule }[] = [];

      for (const [index, rule] of content.rules.entries()) {
        const hit = columns.every(({ column, scope: cellScope, unary }) => {
          const cell = ruleCell(rule, column.id);

          return !cell || matches(cellScope, cell, unary);
        });

        if (!hit) continue;

        const output: Record<string, unknown> = {};

        for (const column of content.outputs) {
          const cell = ruleCell(rule, column.id) || column.defaultValue?.trim();

          if (!cell) continue;

          try {
            setPath(output, column.field, scope.evaluate(cell));
          } catch (error) {
            failed(node, error, { ruleId: rule._id, columnId: column.id });
          }
        }

        const reference_map = Object.fromEntries(
          columns.flatMap(({ column, value }) => (column.field ? [[column.field, value]] : [])),
        );

        hits.push({
          output,
          trace: {
            index,
            ruleId: rule._id,
            ...(rule._description ? { description: rule._description } : {}),
            reference_map,
          },
        });

        if (content.hitPolicy === "first") break;
      }

      if (content.hitPolicy === "first") {
        const [hit] = hits;

        return { output: hit?.output ?? {}, traceData: hit?.trace ?? null };
      }

      return { output: hits.map((hit) => hit.output), traceData: hits.map((hit) => hit.trace) };
    } finally {
      for (const column of columns) if (column.unary) column.scope.dispose();
    }
  });
}

function runExpressions(node: JdmNode, content: ExpressionContent, context: Json) {
  return withScope(context, (scope) => {
    const output: Record<string, unknown> = {};

    for (const expression of content.expressions) {
      if (!expression.key.trim() || !expression.value.trim()) continue;

      const current = scope.with("$", output);

      try {
        setPath(output, expression.key.trim(), current.evaluate(expression.value));
      } catch (error) {
        failed(node, error, { expressionId: expression.id });
      } finally {
        current.dispose();
      }
    }

    return { output, traceData: undefined };
  });
}

function runSwitch(node: JdmNode, content: SwitchContent, context: Json) {
  return withScope(context, (scope) => {
    const conditional = content.statements.filter((statement) => !statement.isDefault);
    const taken: string[] = [];

    for (const statement of conditional) {
      const condition = statement.condition.trim();
      let hit: boolean;

      try {
        hit = !condition || Boolean(scope.evaluate(condition));
      } catch (error) {
        failed(node, error, { statementId: statement.id });
      }

      if (!hit) continue;

      taken.push(statement.id);

      if (content.hitPolicy === "first") break;
    }

    if (taken.length === 0) {
      taken.push(...content.statements.filter((s) => s.isDefault).map((s) => s.id));
    }

    return { taken: new Set(taken), traceData: { statements: taken.map((id) => ({ id })) } };
  });
}

function scoped(content: { inputField?: string | null }, input: Json): Json {
  const field = content.inputField?.trim();

  if (!field) return input;

  return withScope(input, (scope) => scope.evaluate(field));
}

function shaped(
  content: { passThrough?: boolean; outputPath?: string | null },
  input: Json,
  output: Json,
): Json {
  const path = content.outputPath?.trim();
  let result = output;

  if (path) {
    const nested: Record<string, unknown> = {};
    setPath(nested, path, output);
    result = nested;
  }

  return content.passThrough ? merge(input, result) : result;
}

const elapsed = (start: number) => `${(performance.now() - start).toFixed(2)}ms`;

export function runGraph(
  compiled: CompiledDecision,
  input: Json,
  options: { trace?: boolean } = {},
): { output: Json; trace?: DecisionTrace } {
  const outputs = new Map<string, Json>();
  const switches = new Map<string, Set<string>>();
  const trace: DecisionTrace = {};
  let result: Json = null;
  let reachedOutput = false;

  for (const node of compiled.order) {
    const edges = compiled.incoming.get(node.id) ?? [];

    const active = edges.filter((edge) => {
      if (!outputs.has(edge.sourceId)) return false;

      const taken = switches.get(edge.sourceId);

      return !taken || (edge.sourceHandle != null && taken.has(edge.sourceHandle));
    });

    if (node.type !== "inputNode" && active.length === 0) continue;

    const nodeInput =
      node.type === "inputNode"
        ? input
        : active.reduce<Json>((acc, edge) => merge(acc, outputs.get(edge.sourceId)), {});

    const start = performance.now();
    let output: Json = nodeInput;
    let traceData: NodeTrace["traceData"];

    if (node.type === "decisionTableNode") {
      const ran = runTable(node, node.content, scoped(node.content, nodeInput));
      output = shaped(node.content, nodeInput, ran.output);
      traceData = ran.traceData;
    } else if (node.type === "expressionNode") {
      const ran = runExpressions(node, node.content, scoped(node.content, nodeInput));
      output = shaped(node.content, nodeInput, ran.output);
    } else if (node.type === "switchNode") {
      const ran = runSwitch(node, node.content, nodeInput);
      switches.set(node.id, ran.taken);
      traceData = ran.traceData;
    } else if (node.type === "outputNode") {
      result = reachedOutput ? merge(result, nodeInput) : nodeInput;
      reachedOutput = true;
    }

    outputs.set(node.id, output);

    if (options.trace) {
      trace[node.id] = {
        id: node.id,
        name: node.name,
        type: node.type,
        input: nodeInput,
        output,
        performance: elapsed(start),
        ...(traceData !== undefined ? { traceData } : {}),
      };
    }
  }

  return options.trace ? { output: result, trace } : { output: result };
}
