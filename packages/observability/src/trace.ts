import { context, propagation, trace, type Span } from "@opentelemetry/api";

export const tracer = trace.getTracer("pas");

/** Serialize the active trace context so it can travel inside a job payload. */
export function injectTraceContext(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

/** Run `fn` in a span that continues the trace carried in a job payload. */
export function withExtractedContext<T>(
  carrier: Record<string, string> | undefined,
  spanName: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const parent = carrier ? propagation.extract(context.active(), carrier) : context.active();
  return context.with(parent, () =>
    tracer.startActiveSpan(spanName, async (span) => {
      try {
        return await fn(span);
      } catch (error) {
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    }),
  );
}
