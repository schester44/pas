import type { DecisionKind } from "@pas/decisions-engine";

export interface Column {
  id: string;
  name: string;
  field: string;
}

export type Row = Record<string, string> & { _description: string };

export interface SeedDecision {
  kind: DecisionKind;
  key: string;
  name: string;
  decision: ReturnType<typeof table>;
  tests: { id: string; name: string; input: Record<string, unknown>; expected: unknown }[];
}

export const col = (id: string, field: string, name = id): Column => ({ id, name, field });

/** Output columns named after the contract fields they fill. */
export const outputs = (...fields: string[]) => fields.map((field) => col(field, field));

export const text = (value: string) => JSON.stringify(value);

export const list = (values: readonly (string | number)[]) => JSON.stringify(values);

/** A one-table JDM graph; every row gets an id and an empty cell for any column it skips. */
export function table(
  name: string,
  inputs: Column[],
  outputColumns: Column[],
  rows: Row[],
  hitPolicy: "collect" | "first" = "collect",
) {
  const columns = [...inputs, ...outputColumns].map((column) => column.id);

  return {
    nodes: [
      { id: "request", name: "Request", type: "inputNode", position: { x: 80, y: 200 } },
      {
        id: "table",
        name,
        type: "decisionTableNode",
        content: {
          rules: rows.map((row, i) => ({
            _id: `r${i + 1}`,
            ...Object.fromEntries(columns.map((id) => [id, row[id] ?? ""])),
            _description: row._description,
          })),
          inputs,
          outputs: outputColumns,
          hitPolicy,
        },
        position: { x: 380, y: 200 },
      },
      { id: "response", name: "Response", type: "outputNode", position: { x: 700, y: 200 } },
    ],
    edges: [
      { id: "request-table", type: "edge", sourceId: "request", targetId: "table" },
      { id: "table-response", type: "edge", sourceId: "table", targetId: "response" },
    ],
  };
}

export function decision(
  kind: DecisionKind,
  name: string,
  graph: ReturnType<typeof table>,
  tests: SeedDecision["tests"] = [],
): SeedDecision {
  return { kind, key: "main", name, decision: graph, tests };
}
