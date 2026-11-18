import type {
  DecisionTableContent,
  JdmDecision,
  TableColumn,
  TableRule,
} from "@pas/decisions-engine";
import { COMPOSITE_KEYS, indexSchema, isField, type RiskSchema } from "@pas/forms-core";

export type TableNode = Extract<JdmDecision["nodes"][number], { type: "decisionTableNode" }>;

export const newId = () => crypto.randomUUID();

export function tableNodes(decision: JdmDecision): TableNode[] {
  return decision.nodes.filter((node): node is TableNode => node.type === "decisionTableNode");
}

export function tableDecision(name: string, content: DecisionTableContent): JdmDecision {
  return {
    nodes: [
      { id: "request", name: "Request", type: "inputNode", position: { x: 80, y: 200 } },
      { id: "table", name, type: "decisionTableNode", position: { x: 380, y: 200 }, content },
      { id: "response", name: "Response", type: "outputNode", position: { x: 700, y: 200 } },
    ],
    edges: [
      { id: "request-table", sourceId: "request", targetId: "table", type: "edge" },
      { id: "table-response", sourceId: "table", targetId: "response", type: "edge" },
    ],
  };
}

export function updateTable(
  decision: JdmDecision,
  nodeId: string,
  update: (content: DecisionTableContent) => DecisionTableContent,
): JdmDecision {
  return {
    ...decision,
    nodes: decision.nodes.map((node) =>
      node.id === nodeId && node.type === "decisionTableNode"
        ? { ...node, content: update(node.content as DecisionTableContent) }
        : node,
    ),
  };
}

export const blankRule = (): TableRule => ({ _id: newId() });

export function moveRule(rules: TableRule[], index: number, by: number): TableRule[] {
  const target = index + by;

  if (target < 0 || target >= rules.length) return rules;

  const next = [...rules];
  const [rule] = next.splice(index, 1);
  next.splice(target, 0, rule!);

  return next;
}

export function setCell(rules: TableRule[], ruleId: string, columnId: string, value: string) {
  return rules.map((rule) => (rule._id === ruleId ? { ...rule, [columnId]: value } : rule));
}

export function removeColumn(
  content: DecisionTableContent,
  side: "inputs" | "outputs",
  columnId: string,
): DecisionTableContent {
  return {
    ...content,
    [side]: content[side].filter((column: TableColumn) => column.id !== columnId),
    rules: content.rules.map(({ [columnId]: _removed, ...rule }) => rule as TableRule),
  };
}

export function schemaPaths(schema: RiskSchema): string[] {
  return [...indexSchema(schema).values()].flatMap((node) => {
    const parts = isField(node) ? (COMPOSITE_KEYS[node.kind] ?? []) : [];

    return [node.path, ...parts.map((part) => `${node.path}.${part}`)];
  });
}

export function humanize(field: string): string {
  const words = field
    .replace(/[._]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();

  return words.charAt(0).toUpperCase() + words.slice(1);
}
