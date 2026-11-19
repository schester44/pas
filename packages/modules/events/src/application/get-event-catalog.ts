import { z } from "zod";
import { CATALOG_VERSION } from "../domain/event-types";
import { catalogEntries } from "./catalog";
import { envelopeSchema, eventDataSchemas } from "./payloads";

const groupOf = (type: string) => type.slice(0, type.indexOf("."));

function build() {
  return {
    version: CATALOG_VERSION,
    envelope: z.toJSONSchema(envelopeSchema, { unrepresentable: "any" }),
    types: catalogEntries().map((entry) => ({
      type: entry.type,
      group: groupOf(entry.type),
      title: entry.title,
      description: entry.description,
      schema: z.toJSONSchema(eventDataSchemas[entry.type], { unrepresentable: "any" }),
      sample: {
        id: "evt_0199a3f0a1b27c3d8e4f5a6b7c8d9e0f",
        object: "event",
        type: entry.type,
        apiVersion: CATALOG_VERSION,
        createdAt: "2026-11-18T15:04:05.000Z",
        environment: "production",
        data: entry.sample,
      },
    })),
  };
}

/** The documented public event catalog: every type with its JSON Schema and a sample. */
export function makeGetEventCatalog() {
  let cached: ReturnType<typeof build> | undefined;

  return function getEventCatalog() {
    cached ??= build();

    return cached;
  };
}

export type GetEventCatalog = ReturnType<typeof makeGetEventCatalog>;
