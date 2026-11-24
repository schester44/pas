import type { Invocation, InvocationResult } from "@pas/sandbox/protocol";

export type ToThread =
  | { type: "invoke"; invocation: Invocation }
  | {
      type: "host_result";
      invocationId: string;
      callId: number;
      ok: boolean;
      value?: unknown;
      error?: string;
    }
  | { type: "cancel"; invocationId: string };

export type FromThread =
  | { type: "host_call"; invocationId: string; callId: number; name: string; args: unknown }
  | { type: "done"; invocationId: string; result: InvocationResult };
