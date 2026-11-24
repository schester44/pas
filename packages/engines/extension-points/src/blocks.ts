import { isRecord } from "@pas/kernel";

export type BlockTone = "neutral" | "info" | "success" | "warning" | "danger";

/** The fixed vocabulary extensions use to show things; `@pas/ui` renders them. */
export type DisplayBlock =
  | { type: "fields"; title?: string; items: { label: string; value: string }[] }
  | { type: "table"; title?: string; columns: string[]; rows: string[][] }
  | { type: "status"; label: string; tone: BlockTone; detail?: string }
  | { type: "alert"; tone: BlockTone; title: string; body?: string }
  | { type: "link"; label: string; href: string };

const TONES = new Set<BlockTone>(["neutral", "info", "success", "warning", "danger"]);
const MAX_BLOCKS = 20;
const MAX_ROWS = 100;
const MAX_COLUMNS = 12;

const str = (value: unknown, max: number) =>
  value === undefined || value === null ? "" : String(value).slice(0, max);

export function parseBlocks(value: unknown, issue: (message: string) => void): DisplayBlock[] {
  if (!Array.isArray(value)) {
    issue("blocks must be a list");

    return [];
  }

  if (value.length > MAX_BLOCKS) issue(`Show at most ${MAX_BLOCKS} blocks`);

  return value.slice(0, MAX_BLOCKS).flatMap((raw, i): DisplayBlock[] => {
    if (!isRecord(raw)) {
      issue(`blocks[${i}] must be an object`);

      return [];
    }

    const title = raw.title === undefined ? undefined : str(raw.title, 200);
    const tone = TONES.has(raw.tone as BlockTone) ? (raw.tone as BlockTone) : "neutral";

    switch (raw.type) {
      case "fields": {
        if (!Array.isArray(raw.items)) {
          issue(`blocks[${i}].items must be a list`);

          return [];
        }

        return [
          {
            type: "fields",
            ...(title !== undefined && { title }),
            items: raw.items.slice(0, MAX_ROWS).map((item) => ({
              label: str(isRecord(item) ? item.label : "", 200),
              value: str(isRecord(item) ? item.value : "", 1_000),
            })),
          },
        ];
      }

      case "table": {
        if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows)) {
          issue(`blocks[${i}] needs columns and rows`);

          return [];
        }

        const columns = raw.columns.slice(0, MAX_COLUMNS).map((c) => str(c, 100));

        return [
          {
            type: "table",
            ...(title !== undefined && { title }),
            columns,
            rows: raw.rows
              .slice(0, MAX_ROWS)
              .map((row) =>
                columns.map((_, c) => str(Array.isArray(row) ? row[c] : undefined, 500)),
              ),
          },
        ];
      }

      case "status":
        return [
          {
            type: "status",
            label: str(raw.label, 200),
            tone,
            ...(raw.detail !== undefined && { detail: str(raw.detail, 500) }),
          },
        ];

      case "alert":
        return [
          {
            type: "alert",
            tone,
            title: str(raw.title, 200),
            ...(raw.body !== undefined && { body: str(raw.body, 2_000) }),
          },
        ];

      case "link": {
        const href = str(raw.href, 2_000);

        if (!href.startsWith("https://")) {
          issue(`blocks[${i}].href must be an https link`);

          return [];
        }

        return [{ type: "link", label: str(raw.label, 200), href }];
      }

      default:
        issue(`blocks[${i}].type must be fields, table, status, alert or link`);

        return [];
    }
  });
}
