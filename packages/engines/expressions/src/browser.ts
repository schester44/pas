import wasmUrl from "@gorules/zen-engine-wasm/dist/zen_engine_wasm_bg.wasm?url";
import { markReady, setPending, zen } from "./runtime";

setPending(zen.default({ module_or_path: wasmUrl }).then(() => markReady()));

export * from "./index";
