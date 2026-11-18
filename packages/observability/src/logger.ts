import { trace } from "@opentelemetry/api";
import { pino, type Logger } from "pino";

export type { Logger };

/**
 * Structured JSON logger. Adds the active trace/span ids so logs correlate with traces.
 * Set LOG_PRETTY=true (dev scripts do) for human-readable output; bundled builds log JSON.
 */
export function createLogger(service: string): Logger {
  const pretty = process.env.LOG_PRETTY === "true";
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? "info",
    mixin() {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const { traceId, spanId } = span.spanContext();
      return { traceId, spanId };
    },
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  });
}
