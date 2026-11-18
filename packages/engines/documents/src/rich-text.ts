export interface Run {
  text: string;
  bold?: boolean;
}

export type RichBlock = { kind: "paragraph"; runs: Run[] } | { kind: "list"; items: Run[][] };

function runs(text: string): Run[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**") && part.length > 4
        ? { text: part.slice(2, -2), bold: true }
        : { text: part },
    );
}

const BULLET = /^\s*[-•]\s+/;

/** Paragraphs split on blank lines, `- ` bullet lists and `**bold**`; nothing else. */
export function parseRichText(source: string): RichBlock[] {
  const blocks: RichBlock[] = [];

  for (const chunk of source.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").filter((line) => line.trim());

    if (lines.length === 0) continue;

    if (lines.every((line) => BULLET.test(line))) {
      blocks.push({ kind: "list", items: lines.map((line) => runs(line.replace(BULLET, ""))) });
    } else {
      blocks.push({ kind: "paragraph", runs: runs(lines.map((line) => line.trim()).join(" ")) });
    }
  }

  return blocks;
}
