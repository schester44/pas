import { z } from "zod";

export const FIELD_KINDS = [
  "text",
  "number",
  "integer",
  "money",
  "percent",
  "date",
  "boolean",
  "enum",
  "multi_enum",
  "address",
  "phone",
  "email",
  "file",
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

export interface EnumOption {
  value: string;
  label: string;
}

interface NodeBase {
  key: string;
  label: string;
  description?: string;
}

export interface FieldNode extends NodeBase {
  kind: FieldKind;
  endorsable?: boolean;
  pii?: boolean;
  options?: EnumOption[];
  currency?: string;
  country?: string;
}

export interface GroupNode extends NodeBase {
  kind: "group";
  exposure?: string;
  children: SchemaNode[];
}

export interface RepeatableNode extends NodeBase {
  kind: "repeatable";
  exposure?: string;
  minItems?: number;
  maxItems?: number;
  children: SchemaNode[];
}

export type SchemaNode = FieldNode | GroupNode | RepeatableNode;

export interface RiskSchema {
  fields: SchemaNode[];
}

export interface AddressValue {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface FileValue {
  id: string;
  name: string;
  size?: number;
  contentType?: string;
}

export const COMPOSITE_KEYS: Partial<Record<FieldKind, readonly string[]>> = {
  address: ["line1", "line2", "city", "region", "postalCode", "country"],
  file: ["id", "name", "size", "contentType"],
};

const key = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use letters, digits and _ only");
const base = { key, label: z.string().min(1), description: z.string().optional() };

const fieldNodeSchema = z
  .object({
    ...base,
    kind: z.enum(FIELD_KINDS),
    endorsable: z.boolean().optional(),
    pii: z.boolean().optional(),
    options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
  })
  .refine(
    (field) =>
      !(field.kind === "enum" || field.kind === "multi_enum") || (field.options?.length ?? 0) > 0,
    { message: "Enum fields need at least one option", path: ["options"] },
  );

const groupNodeSchema = z.object({
  ...base,
  kind: z.literal("group"),
  exposure: z.string().min(1).optional(),
  get children() {
    return z.array(schemaNodeSchema);
  },
});

const repeatableNodeSchema = z
  .object({
    ...base,
    kind: z.literal("repeatable"),
    exposure: z.string().min(1).optional(),
    minItems: z.number().int().min(0).optional(),
    maxItems: z.number().int().min(1).optional(),
    get children() {
      return z.array(schemaNodeSchema);
    },
  })
  .refine((node) => node.maxItems === undefined || (node.minItems ?? 0) <= node.maxItems, {
    message: "minItems can't exceed maxItems",
  });

const schemaNodeSchema: z.ZodType<SchemaNode> = z.union([
  fieldNodeSchema,
  groupNodeSchema,
  repeatableNodeSchema,
]);

export const riskSchemaSchema: z.ZodType<RiskSchema> = z.object({
  fields: z.array(schemaNodeSchema),
});

export type IndexedNode = SchemaNode & { path: string };

export type SchemaIndex = Map<string, IndexedNode>;

export function indexSchema(schema: RiskSchema): SchemaIndex {
  const index: SchemaIndex = new Map();

  const walk = (nodes: SchemaNode[], prefix: string) => {
    for (const node of nodes) {
      const path = prefix ? `${prefix}.${node.key}` : node.key;
      index.set(path, { ...node, path });

      if (node.kind === "group") walk(node.children, path);

      if (node.kind === "repeatable") walk(node.children, `${path}[]`);
    }
  };

  walk(schema.fields, "");

  return index;
}

export function isField(node: SchemaNode | undefined): node is FieldNode {
  return node !== undefined && node.kind !== "group" && node.kind !== "repeatable";
}

export function resolvesInSchema(index: SchemaIndex, path: string): boolean {
  if (index.has(path)) return true;

  if (path.endsWith("[]")) {
    const node = index.get(path.slice(0, -2));

    return node?.kind === "repeatable" || node?.kind === "multi_enum";
  }

  const dot = path.lastIndexOf(".");

  if (dot < 0) return false;

  const parent = index.get(path.slice(0, dot));
  const keys = parent && isField(parent) ? COMPOSITE_KEYS[parent.kind] : undefined;

  return keys?.includes(path.slice(dot + 1)) ?? false;
}
