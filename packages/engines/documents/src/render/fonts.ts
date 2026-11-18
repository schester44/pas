import { Font } from "@react-pdf/renderer";

export const FONT_FAMILY = "Inter";

export interface FontSources {
  regular: string;
  italic: string;
  medium: string;
  semibold: string;
}

let registered = false;

export function registerFonts(sources: FontSources): void {
  if (registered) return;

  registered = true;

  Font.register({
    family: FONT_FAMILY,
    fonts: [
      { src: sources.regular, fontWeight: 400 },
      { src: sources.italic, fontWeight: 400, fontStyle: "italic" },
      { src: sources.medium, fontWeight: 500 },
      { src: sources.semibold, fontWeight: 600 },
    ],
  });

  Font.registerHyphenationCallback((word) => [word]);
}
