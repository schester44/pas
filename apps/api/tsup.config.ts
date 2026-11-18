import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node26",
  platform: "node",
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so bundle them (and their deps) into one file.
  noExternal: [/.*/],
  // Bundled CommonJS deps (pg, etc.) call require(); give ESM output a real one.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
