import { evaluate } from "@pas/expressions";
import { type ScheduleContext, scheduleData } from "./context";
import type { ScheduleEntry, ScheduledDocument } from "./model";

export interface PacketError {
  entry: string;
  message: string;
}

export interface Packet {
  entries: ScheduleEntry[];
  errors: PacketError[];
}

export const documentRef = (document: ScheduledDocument) =>
  document.kind === "template" ? `template:${document.key}` : `form:${document.editionId}`;

/** The schedule entries that attach to this transaction and whose `includeWhen` holds, in order. */
export function buildPacket(schedule: readonly ScheduleEntry[], context: ScheduleContext): Packet {
  const data = scheduleData(context);
  const errors: PacketError[] = [];
  const seen = new Set<string>();

  const included = schedule.filter((entry) => {
    if (!entry.attachTo.includes(context.transaction)) return false;

    if (!entry.includeWhen?.trim()) return true;

    try {
      return evaluate(entry.includeWhen, data) === true;
    } catch (error) {
      errors.push({ entry: entry.id, message: (error as Error).message });

      return false;
    }
  });

  const entries = included
    .map((entry, position) => ({ entry, position }))
    .toSorted((a, b) => a.entry.order - b.entry.order || a.position - b.position)
    .map(({ entry }) => entry)
    .filter((entry) => {
      const ref = documentRef(entry.document);

      if (seen.has(ref)) return false;

      seen.add(ref);

      return true;
    });

  return { entries, errors };
}
