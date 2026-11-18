import * as zen from "@gorules/zen-engine-wasm";

let initialized = false;
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();

export { zen };

export function markReady(): void {
  initialized = true;

  for (const listener of listeners) listener();

  listeners.clear();
}

export function setPending(promise: Promise<void>): void {
  pending = promise;
}

export function isReady(): boolean {
  return initialized;
}

export function ready(): Promise<void> {
  if (initialized) return Promise.resolve();

  if (!pending) throw new Error("@pas/expressions: no runtime entry was loaded");

  return pending;
}

export function onReady(listener: () => void): () => void {
  if (initialized) return () => {};

  listeners.add(listener);

  return () => listeners.delete(listener);
}

export class ExpressionsNotReadyError extends Error {
  constructor() {
    super("Expressions engine isn't ready yet. Await ready() before evaluating.");
    this.name = "ExpressionsNotReadyError";
  }
}

export function assertReady(): void {
  if (!initialized) throw new ExpressionsNotReadyError();
}
