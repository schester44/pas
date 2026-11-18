import { z } from "zod";

const position = z.object({ x: z.number(), y: z.number() });

const nodeBase = {
  id: z.string().min(1),
  name: z.string(),
  position: position.optional(),
};

const transform = {
  passThrough: z.boolean().optional(),
  inputField: z.string().nullish(),
  outputPath: z.string().nullish(),
};

export const tableColumnSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  field: z.string().optional(),
  defaultValue: z.string().optional(),
});

export const tableRuleSchema = z.looseObject({
  _id: z.string().min(1),
  _description: z.string().optional(),
});

export const decisionTableContentSchema = z.object({
  hitPolicy: z.enum(["first", "collect"]),
  inputs: z.array(tableColumnSchema),
  outputs: z.array(tableColumnSchema.extend({ field: z.string().min(1) })),
  rules: z.array(tableRuleSchema),
  ...transform,
});

export const expressionContentSchema = z.object({
  expressions: z.array(z.object({ id: z.string().min(1), key: z.string(), value: z.string() })),
  ...transform,
});

export const switchContentSchema = z.object({
  hitPolicy: z.enum(["first", "collect"]).default("first"),
  statements: z.array(
    z.object({ id: z.string().min(1), condition: z.string(), isDefault: z.boolean().optional() }),
  ),
});

export const jdmNodeSchema = z.discriminatedUnion("type", [
  z.object({ ...nodeBase, type: z.literal("inputNode"), content: z.unknown().optional() }),
  z.object({ ...nodeBase, type: z.literal("outputNode"), content: z.unknown().optional() }),
  z.object({
    ...nodeBase,
    type: z.literal("decisionTableNode"),
    content: decisionTableContentSchema,
  }),
  z.object({ ...nodeBase, type: z.literal("expressionNode"), content: expressionContentSchema }),
  z.object({ ...nodeBase, type: z.literal("switchNode"), content: switchContentSchema }),
  z.object({
    ...nodeBase,
    type: z.enum(["functionNode", "decisionNode", "customNode"]),
    content: z.unknown().optional(),
  }),
]);

export const jdmEdgeSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  sourceHandle: z.string().nullish(),
  type: z.string().optional(),
});

export const jdmSchema = z.object({
  nodes: z.array(jdmNodeSchema),
  edges: z.array(jdmEdgeSchema),
});

export type JdmDecision = z.input<typeof jdmSchema>;
export type JdmGraph = z.output<typeof jdmSchema>;
export type JdmNode = JdmGraph["nodes"][number];
export type JdmEdge = JdmGraph["edges"][number];
export type DecisionTableContent = z.output<typeof decisionTableContentSchema>;
export type TableColumn = z.output<typeof tableColumnSchema>;
export type TableRule = z.output<typeof tableRuleSchema>;
export type ExpressionContent = z.output<typeof expressionContentSchema>;
export type SwitchContent = z.output<typeof switchContentSchema>;
export type DecisionTableNode = Extract<JdmNode, { type: "decisionTableNode" }>;

export const SUPPORTED_NODE_TYPES = [
  "inputNode",
  "outputNode",
  "decisionTableNode",
  "expressionNode",
  "switchNode",
] as const;

export function ruleCell(rule: TableRule, columnId: string): string {
  const value = rule[columnId];

  return typeof value === "string" ? value.trim() : "";
}
