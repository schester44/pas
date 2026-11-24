import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/thread.ts"],
  format: ["esm"],
  target: "node26",
  platform: "node",
  sourcemap: true,
  clean: true,
  // QuickJS loads its .wasm file relative to its own module, so it stays in node_modules.
  noExternal: [/^(?!quickjs-emscripten|@jitl\/quickjs-)/],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
