import { evaluate, referencedPaths, validate, validateUnary } from "@pas/expressions";
import { topologicalOrder } from "./graph";
import {
  type DecisionTableContent,
  type JdmGraph,
  type JdmNode,
  jdmSchema,
  ruleCell,
  SUPPORTED_NODE_TYPES,
  type TableRule,
} from "./jdm";
import { checkContractValue, contractFields, DECISION_KINDS, type DecisionKind } from "./kinds";

export type DecisionIssueCode =
  | "invalid_jdm"
  | "graph"
  | "unsupported_node"
  | "invalid_expression"
  | "unknown_field"
  | "missing_output"
  | "unknown_output"
  | "invalid_output"
  | "empty_cell"
  | "hit_policy";

export interface DecisionIssue {
  severity: "error" | "warning";
  code: DecisionIssueCode;
  message: string;
  nodeId?: string;
  ruleId?: string;
  columnId?: string;
  path?: string;
}

type Where = Pick<DecisionIssue, "nodeId" | "ruleId" | "columnId">;

interface Expression {
  source: string;
  unary: boolean;
  aliases?: Record<string, null>;
  where: Where;
  relative: boolean;
}

function prefix(path: string, content: { outputPath?: string | null }) {
  const base = content.outputPath?.trim();

  return base ? `${base}.${path}` : path;
}

function producedFields(node: JdmNode): string[] {
  if (node.type === "decisionTableNode") {
    return node.content.outputs.map((column) => prefix(column.field, node.content));
  }

  if (node.type === "expressionNode") {
    return node.content.expressions
      .filter((expression) => expression.key.trim())
      .map((expression) => prefix(expression.key.trim(), node.content));
  }

  return [];
}

function expressionsOf(node: JdmNode): Expression[] {
  const out: Expression[] = [];

  const add = (source: string | undefined, unary: boolean, where: Where, relative = false) => {
    if (source?.trim()) out.push({ source: source.trim(), unary, where, relative });
  };

  if (node.type === "decisionTableNode") {
    const relative = Boolean(node.content.inputField?.trim());

    for (const column of node.content.inputs) {
      add(column.field, false, { nodeId: node.id, columnId: column.id }, relative);
    }

    for (const rule of node.content.rules) {
      for (const column of node.content.inputs) {
        const where = { nodeId: node.id, ruleId: rule._id, columnId: column.id };
        add(ruleCell(rule, column.id), Boolean(column.field?.trim()), where, relative);
      }

      for (const column of node.content.outputs) {
        const where = { nodeId: node.id, ruleId: rule._id, columnId: column.id };
        add(ruleCell(rule, column.id), false, where, relative);
      }
    }
  }

  if (node.type === "expressionNode") {
    const relative = Boolean(node.content.inputField?.trim());

    for (const expression of node.content.expressions) {
      out.push(
        ...(expression.value.trim()
          ? [
              {
                source: expression.value.trim(),
                unary: false,
                aliases: { $: null },
                where: { nodeId: node.id, columnId: expression.id },
                relative,
              },
            ]
          : []),
      );
    }
  }

  if (node.type === "switchNode") {
    for (const statement of node.content.statements) {
      add(statement.condition, false, { nodeId: node.id, columnId: statement.id });
    }
  }

  return out;
}

function pathsOf(expression: Expression): string[] {
  return referencedPaths(expression.source, {
    unary: expression.unary,
    ...(expression.aliases ? { aliases: expression.aliases } : {}),
  });
}

function knownPaths(paths: Iterable<string>) {
  const exact = new Set<string>();
  const parents = new Set<string>();

  for (const path of paths) {
    exact.add(path);

    for (let i = 0; i < path.length; i++) {
      if (path[i] === "." || path.startsWith("[]", i)) parents.add(path.slice(0, i));
    }
  }

  return (path: string) =>
    exact.has(path) ||
    parents.has(path) ||
    (path.endsWith("[]") && (exact.has(path.slice(0, -2)) || parents.has(path.slice(0, -2))));
}

function structure(graph: JdmGraph): DecisionIssue[] {
  const issues: DecisionIssue[] = [];
  const ids = new Set(graph.nodes.map((node) => node.id));
  const count = (type: JdmNode["type"]) => graph.nodes.filter((n) => n.type === type).length;

  if (count("inputNode") !== 1) {
    issues.push({ severity: "error", code: "graph", message: "Add exactly one input node" });
  }

  if (count("outputNode") === 0) {
    issues.push({ severity: "error", code: "graph", message: "Add an output node" });
  }

  for (const edge of graph.edges) {
    if (!ids.has(edge.sourceId) || !ids.has(edge.targetId)) {
      issues.push({
        severity: "error",
        code: "graph",
        message: "A connection points at a node that doesn't exist",
      });
    }
  }

  if (!topologicalOrder(graph)) {
    issues.push({ severity: "error", code: "graph", message: "The decision graph has a cycle" });
  }

  for (const node of graph.nodes) {
    if (!(SUPPORTED_NODE_TYPES as readonly string[]).includes(node.type)) {
      issues.push({
        severity: "error",
        code: "unsupported_node",
        nodeId: node.id,
        message: `${node.name || node.type} can't run here; only tables, expressions and switches are supported`,
      });
    }
  }

  return issues;
}

function isConstant(source: string): boolean {
  return validate(source).ok && referencedPaths(source).length === 0;
}

function tableContract(
  kind: DecisionKind,
  node: JdmNode & { content: DecisionTableContent },
): DecisionIssue[] {
  const issues: DecisionIssue[] = [];
  const fields = contractFields(kind);
  const definition = DECISION_KINDS[kind];

  if (definition.cardinality === "one" && node.content.hitPolicy === "collect") {
    issues.push({
      severity: "warning",
      code: "hit_policy",
      nodeId: node.id,
      message: `${definition.label} expects one result; use the first-match hit policy`,
    });
  }

  for (const column of node.content.outputs) {
    if (!fields.some((field) => field.key === column.field)) {
      issues.push({
        severity: "warning",
        code: "unknown_output",
        nodeId: node.id,
        columnId: column.id,
        message: `${column.field} isn't part of the ${definition.label.toLowerCase()} contract`,
      });
    }
  }

  const required = fields.filter((field) => field.required);

  for (const rule of node.content.rules) {
    issues.push(...ruleContract(kind, node, rule, required));
  }

  return issues;
}

function ruleContract(
  kind: DecisionKind,
  node: JdmNode & { content: DecisionTableContent },
  rule: TableRule,
  required: { key: string }[],
): DecisionIssue[] {
  const issues: DecisionIssue[] = [];
  const row: Record<string, unknown> = {};
  let allConstant = true;

  for (const column of node.content.outputs) {
    const where = { nodeId: node.id, ruleId: rule._id, columnId: column.id };
    const cell = ruleCell(rule, column.id) || column.defaultValue?.trim() || "";

    if (!cell) {
      if (required.some((field) => field.key === column.field)) {
        issues.push({
          severity: "error",
          code: "empty_cell",
          ...where,
          message: `${column.name || column.field} is required`,
        });
      }

      continue;
    }

    if (!isConstant(cell)) {
      allConstant = false;
      continue;
    }

    const value = evaluate(cell);

    if (value === null) continue;

    row[column.field] = value;
    const problem = checkContractValue(kind, column.field, value);

    if (problem)
      issues.push({ severity: "error", code: "invalid_output", ...where, message: problem });
  }

  const schema = DECISION_KINDS[kind].row;

  if (!schema || !allConstant || issues.length > 0) return issues;

  const parsed = schema.safeParse(row);

  if (parsed.success) return issues;

  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "");

    if (required.some((r) => r.key === field) && !(field in row)) continue;

    const column = node.content.outputs.find((c) => c.field === field);

    issues.push({
      severity: "error",
      code: "invalid_output",
      nodeId: node.id,
      ruleId: rule._id,
      ...(column ? { columnId: column.id } : {}),
      message: issue.message,
    });
  }

  return issues;
}

function contract(kind: DecisionKind, graph: JdmGraph): DecisionIssue[] {
  if (!DECISION_KINDS[kind].row) return [];

  const outputs = new Set(graph.nodes.filter((n) => n.type === "outputNode").map((n) => n.id));

  const sources = new Set(
    graph.edges.filter((edge) => outputs.has(edge.targetId)).map((edge) => edge.sourceId),
  );

  const terminal = graph.nodes.filter((node) => sources.has(node.id));
  const produced = new Set(terminal.flatMap(producedFields));
  const issues: DecisionIssue[] = [];

  for (const field of contractFields(kind)) {
    if (field.required && !produced.has(field.key) && terminal.length > 0) {
      issues.push({
        severity: "error",
        code: "missing_output",
        nodeId: terminal[0]!.id,
        path: field.key,
        message: `Add a ${field.key} output; the ${DECISION_KINDS[kind].label.toLowerCase()} contract requires it`,
      });
    }
  }

  for (const node of terminal) {
    if (node.type === "decisionTableNode") issues.push(...tableContract(kind, node));
  }

  return issues;
}

export function readPaths(graph: JdmGraph): string[] {
  const produced = knownPaths(graph.nodes.flatMap(producedFields));
  const found = new Set<string>();

  for (const node of graph.nodes) {
    for (const expression of expressionsOf(node)) {
      if (expression.relative) continue;

      try {
        for (const path of pathsOf(expression)) if (!produced(path)) found.add(path);
      } catch {}
    }
  }

  return [...found];
}

export function checkDecision(
  kind: DecisionKind,
  artifact: unknown,
  schemaPaths: Iterable<string>,
): DecisionIssue[] {
  const parsed = jdmSchema.safeParse(artifact);

  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      severity: "error",
      code: "invalid_jdm",
      path: issue.path.join("."),
      message: issue.message,
    }));
  }

  const graph = parsed.data;
  const issues = structure(graph);
  const known = knownPaths([...schemaPaths, ...graph.nodes.flatMap(producedFields)]);

  for (const node of graph.nodes) {
    for (const expression of expressionsOf(node)) {
      const check = expression.unary
        ? validateUnary(expression.source)
        : validate(expression.source);

      if (!check.ok) {
        issues.push({
          severity: "error",
          code: "invalid_expression",
          ...expression.where,
          message: check.message,
        });

        continue;
      }

      if (expression.relative) continue;

      let paths: string[];

      try {
        paths = pathsOf(expression);
      } catch (error) {
        issues.push({
          severity: "error",
          code: "invalid_expression",
          ...expression.where,
          message: (error as Error).message,
        });

        continue;
      }

      for (const path of paths.filter((p) => !known(p))) {
        issues.push({
          severity: "error",
          code: "unknown_field",
          ...expression.where,
          path,
          message: `${path} isn't in the risk schema`,
        });
      }
    }
  }

  return [...issues, ...contract(kind, graph)];
}
