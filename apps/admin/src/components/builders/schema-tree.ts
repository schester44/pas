import { FIELD_KINDS, type GroupNode, type RepeatableNode, type SchemaNode } from "@pas/forms-core";
import { hasOptions } from "./kinds";

export type NodePath = readonly number[];
export type Container = GroupNode | RepeatableNode;

export const isContainer = (node: SchemaNode | undefined): node is Container =>
  node?.kind === "group" || node?.kind === "repeatable";

export const pathId = (path: NodePath) => path.join(".");
export const parsePathId = (id: string): NodePath => id.split(".").map(Number);

function withChildren(
  nodes: SchemaNode[],
  parent: NodePath,
  fn: (children: SchemaNode[]) => SchemaNode[],
): SchemaNode[] {
  if (parent.length === 0) return fn(nodes);

  const [head, ...rest] = parent;

  return nodes.map((node, i) =>
    i === head && isContainer(node)
      ? { ...node, children: withChildren(node.children, rest, fn) }
      : node,
  );
}

export function nodeAt(nodes: SchemaNode[], path: NodePath): SchemaNode | undefined {
  let list = nodes;
  let node: SchemaNode | undefined;

  for (const index of path) {
    node = list[index];

    if (!node) return undefined;

    list = isContainer(node) ? node.children : [];
  }

  return node;
}

export function siblingsAt(nodes: SchemaNode[], path: NodePath): SchemaNode[] {
  if (path.length <= 1) return nodes;

  const parent = nodeAt(nodes, path.slice(0, -1));

  return isContainer(parent) ? parent.children : [];
}

export function updateAt(
  nodes: SchemaNode[],
  path: NodePath,
  fn: (node: SchemaNode) => SchemaNode,
): SchemaNode[] {
  const last = path.at(-1)!;

  return withChildren(nodes, path.slice(0, -1), (children) =>
    children.map((node, i) => (i === last ? fn(node) : node)),
  );
}

export function removeAt(nodes: SchemaNode[], path: NodePath): SchemaNode[] {
  const last = path.at(-1)!;

  return withChildren(nodes, path.slice(0, -1), (children) =>
    children.filter((_, i) => i !== last),
  );
}

export function insertAt(
  nodes: SchemaNode[],
  parent: NodePath,
  index: number,
  inserted: SchemaNode[],
): SchemaNode[] {
  return withChildren(nodes, parent, (children) => children.toSpliced(index, 0, ...inserted));
}

export function moveAt(
  nodes: SchemaNode[],
  path: NodePath,
  delta: -1 | 1,
): { nodes: SchemaNode[]; path: NodePath } | undefined {
  const index = path.at(-1)!;
  const target = index + delta;

  if (target < 0 || target >= siblingsAt(nodes, path).length) return undefined;

  const next = withChildren(nodes, path.slice(0, -1), (children) => {
    const copy = [...children];
    [copy[index], copy[target]] = [copy[target]!, copy[index]!];

    return copy;
  });

  return { nodes: next, path: [...path.slice(0, -1), target] };
}

export function canonicalPathAt(nodes: SchemaNode[], path: NodePath): string {
  const parts: string[] = [];
  let list = nodes;

  path.forEach((index, depth) => {
    const node = list[index];

    if (!node) return;

    const last = depth === path.length - 1;
    parts.push(node.kind === "repeatable" && !last ? `${node.key}[]` : node.key);
    list = isContainer(node) ? node.children : [];
  });

  return parts.join(".");
}

export function uniqueKey(siblings: SchemaNode[], base: string): string {
  const taken = new Set(siblings.map((node) => node.key));

  if (!taken.has(base)) return base;

  let n = 2;

  while (taken.has(`${base}${n}`)) n++;

  return `${base}${n}`;
}

export function insertionPoint(
  nodes: SchemaNode[],
  selected: NodePath | undefined,
): { parent: NodePath; index: number } {
  if (!selected) return { parent: [], index: nodes.length };

  const node = nodeAt(nodes, selected);

  if (isContainer(node)) return { parent: selected, index: node.children.length };

  return { parent: selected.slice(0, -1), index: selected.at(-1)! + 1 };
}

export function countDescendants(node: SchemaNode): number {
  return isContainer(node)
    ? node.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0)
    : 0;
}

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KINDS = new Set<string>(FIELD_KINDS);

export type NodeProblems = Partial<
  Record<"key" | "label" | "options" | "currency" | "country" | "items" | "exposure", string>
>;

export function problemsOf(node: SchemaNode, siblings: SchemaNode[]): NodeProblems {
  const problems: NodeProblems = {};

  if (!node.key) problems.key = "Enter a key";
  else if (!KEY.test(node.key))
    problems.key = "Start with a letter; use letters, digits and _ only";
  else if (siblings.filter((sibling) => sibling.key === node.key).length > 1) {
    problems.key = "Another field at this level uses this key";
  }

  if (!node.label.trim()) problems.label = "Enter a label";

  if (isContainer(node)) {
    if (node.exposure !== undefined && !node.exposure.trim())
      problems.exposure = "Name the exposure type";

    if (
      node.kind === "repeatable" &&
      node.maxItems !== undefined &&
      (node.minItems ?? 0) > node.maxItems
    ) {
      problems.items = "Minimum can't exceed the maximum";
    }

    return problems;
  }

  if (!KINDS.has(node.kind)) return problems;

  if (hasOptions(node.kind)) {
    const options = node.options ?? [];
    const values = options.map((option) => option.value);

    if (options.length === 0) problems.options = "Add at least one option";
    else if (options.some((option) => !option.value || !option.label.trim())) {
      problems.options = "Every option needs a label and a value";
    } else if (new Set(values).size !== values.length)
      problems.options = "Option values must be unique";
  }

  if (node.currency !== undefined && !/^[A-Z]{3}$/.test(node.currency)) {
    problems.currency = "Use a three-letter ISO code, like USD";
  }

  if (node.country !== undefined && !/^[A-Z]{2}$/.test(node.country)) {
    problems.country = "Use a two-letter ISO code, like US";
  }

  return problems;
}

export function pathsWithProblems(nodes: SchemaNode[]): Set<string> {
  const found = new Set<string>();

  const walk = (list: SchemaNode[], prefix: number[]) =>
    list.forEach((node, i) => {
      const path = [...prefix, i];

      if (Object.keys(problemsOf(node, list)).length > 0) found.add(pathId(path));

      if (isContainer(node)) walk(node.children, path);
    });

  walk(nodes, []);

  return found;
}
