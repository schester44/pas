/** What extension authors program against: the second argument to their exported function. */
export interface ExtensionContext {
  fetch?: (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: unknown },
  ) => Promise<ExtensionResponse>;
  clock?: { now(): Promise<string> };
  step?: { run<T>(id: string, fn: () => Promise<T>): Promise<T> };
}

export interface ExtensionResponse {
  ok: boolean;
  status: number;
  url: string;
  headers: Record<string, string>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}
