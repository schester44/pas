/** What extension authors program against: the second argument to their exported function. */
export interface ExtensionContext {
  fetch?: (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: unknown },
  ) => Promise<ExtensionResponse>;
  clock?: { now(): Promise<string> };
  step?: { run<T>(id: string, fn: () => Promise<T>): Promise<T> };
  /** Automations only, and only the services the extension declared. */
  pas?: {
    policy?: {
      addNote(args: { policyId: string; summary: string; detail?: string }): Promise<unknown>;
    };
    email?: { send(args: { to: string; subject: string; text: string }): Promise<unknown> };
  };
}

export interface ExtensionResponse {
  ok: boolean;
  status: number;
  url: string;
  headers: Record<string, string>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}
