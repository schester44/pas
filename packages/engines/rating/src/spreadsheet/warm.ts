import { WorkbookEngine } from "./engine";
import type { WorkbookModel } from "./model";

const engines = new Map<string, WorkbookEngine>();
const LIMIT = 64;

export function warmEngine(model: WorkbookModel, built?: WorkbookEngine): WorkbookEngine {
  const cached = engines.get(model.hash);

  if (cached) return cached;

  const engine = built ?? new WorkbookEngine(model);

  if (engines.size >= LIMIT) engines.delete(engines.keys().next().value!);

  engines.set(model.hash, engine);

  return engine;
}
