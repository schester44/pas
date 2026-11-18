import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { markReady, setPending, zen } from "./runtime";

const wasmPath = createRequire(import.meta.url).resolve(
  "@gorules/zen-engine-wasm/dist/zen_engine_wasm_bg.wasm",
);

zen.initSync({ module: readFileSync(wasmPath) });
markReady();
setPending(Promise.resolve());

export * from "./index";
