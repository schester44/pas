import { isReady, onReady } from "@pas/expressions";
import { useSyncExternalStore } from "react";

export function useExpressionsReady(): boolean {
  return useSyncExternalStore(onReady, isReady, isReady);
}
