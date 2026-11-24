import { z } from "zod";

export const sandboxLimitsSchema = z.object({
  memoryBytes: z.number().int().positive(),
  stackBytes: z.number().int().positive(),
  cpuMs: z.number().positive(),
  wallMs: z.number().positive(),
  maxHostCalls: z.number().int().positive(),
  maxOutputBytes: z.number().int().positive(),
});

export type SandboxLimits = z.infer<typeof sandboxLimitsSchema>;

export const defaultSandboxLimits: SandboxLimits = {
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 512 * 1024,
  cpuMs: 250,
  wallMs: 10_000,
  maxHostCalls: 100,
  maxOutputBytes: 1024 * 1024,
};

export const invocationSchema = z.object({
  invocationId: z.string().min(1),
  tenantId: z.string().min(1),
  code: z.string().min(1),
  entry: z.string().min(1),
  input: z.unknown(),
  hostFunctions: z.array(z.string()),
  limits: sandboxLimitsSchema,
});

export type Invocation = z.infer<typeof invocationSchema>;

export const sandboxErrorCodes = [
  "bad_entry",
  "extension_error",
  "cpu_limit",
  "memory_limit",
  "timeout",
  "host_call_limit",
  "output_too_large",
  "invalid_output",
  "never_settled",
  "overloaded",
  "sandbox_crashed",
  "sandbox_unavailable",
] as const;

export type SandboxErrorCode = (typeof sandboxErrorCodes)[number];

export const logEntrySchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
});

export type LogEntry = z.infer<typeof logEntrySchema>;

export const invocationStatsSchema = z.object({
  cpuMs: z.number(),
  wallMs: z.number(),
  hostCalls: z.number().int(),
});

export type InvocationStats = z.infer<typeof invocationStatsSchema>;

export const invocationResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    output: z.unknown(),
    logs: z.array(logEntrySchema),
    stats: invocationStatsSchema,
  }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.enum(sandboxErrorCodes), message: z.string() }),
    logs: z.array(logEntrySchema),
    stats: invocationStatsSchema,
  }),
]);

export type InvocationResult = z.infer<typeof invocationResultSchema>;

/** Frames on the invoke stream, one JSON object per line in each direction. */
export const clientFrameSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("invoke"), invocation: invocationSchema }),
  z.object({
    t: z.literal("host_result"),
    callId: z.number().int(),
    ok: z.boolean(),
    value: z.unknown().optional(),
    error: z.string().optional(),
  }),
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;

export const serverFrameSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("host_call"),
    callId: z.number().int(),
    name: z.string(),
    args: z.unknown(),
  }),
  z.object({ t: z.literal("done"), result: invocationResultSchema }),
]);

export type ServerFrame = z.infer<typeof serverFrameSchema>;

export const MAX_FRAME_BYTES = 8 * 1024 * 1024;

/** Splits a byte stream into newline-delimited JSON frames. */
export function frameReader(onFrame: (frame: unknown) => void, onError: (error: Error) => void) {
  let buffer = "";

  return (chunk: Buffer | string) => {
    buffer += chunk.toString();

    if (buffer.length > MAX_FRAME_BYTES) {
      onError(new Error("Frame too large"));
      buffer = "";

      return;
    }

    let newline = buffer.indexOf("\n");

    while (newline !== -1) {
      const line = buffer.slice(0, newline);

      buffer = buffer.slice(newline + 1);

      if (line.trim().length > 0) {
        try {
          onFrame(JSON.parse(line));
        } catch (error) {
          onError(error instanceof Error ? error : new Error(String(error)));
        }
      }

      newline = buffer.indexOf("\n");
    }
  };
}

export const encodeFrame = (frame: ClientFrame | ServerFrame) => `${JSON.stringify(frame)}\n`;
