import { createRequire } from "node:module";
import { registerFonts } from "./fonts";

const resolve = (file: string) =>
  createRequire(import.meta.url).resolve(`@fontsource/inter/files/inter-latin-${file}.woff`);

registerFonts({
  regular: resolve("400-normal"),
  italic: resolve("400-italic"),
  medium: resolve("500-normal"),
  semibold: resolve("600-normal"),
});

export * from "./shared";
