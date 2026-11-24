// Extension runner (PLAN §15.1): tenant code runs here, away from the API and worker processes.
import { createLogger } from "@pas/observability";
import {
  clientFrameSchema,
  encodeFrame,
  frameReader,
  type InvocationResult,
  type ServerFrame,
} from "@pas/sandbox/protocol";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type ServerHttp2Stream } from "node:http2";
import { availableParallelism } from "node:os";
import { Admission } from "./admission";
import { ThreadPool } from "./pool";

const logger = createLogger("sandbox");
const env = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

const token =
  process.env.SANDBOX_TOKEN ??
  (process.env.NODE_ENV === "development" ? "dev-sandbox-token" : undefined);

if (!token) throw new Error("SANDBOX_TOKEN is required");

const threads = env("SANDBOX_THREADS", Math.max(1, availableParallelism() - 1));
const perThread = env("SANDBOX_THREAD_CONCURRENCY", 16);
const pool = new ThreadPool({ size: threads, heapMb: env("SANDBOX_THREAD_HEAP_MB", 512), logger });

const admission = new Admission({
  total: threads * perThread,
  perTenant: env("SANDBOX_TENANT_CONCURRENCY", 8),
  maxQueued: env("SANDBOX_MAX_QUEUED", 1_000),
});

const expectedAuth = Buffer.from(`Bearer ${token}`);

const authorized = (headers: IncomingHttpHeaders) => {
  const given = Buffer.from(String(headers.authorization ?? ""));

  return given.length === expectedAuth.length && timingSafeEqual(given, expectedAuth);
};

const rejected = (
  code: "overloaded" | "sandbox_unavailable",
  message: string,
): InvocationResult => ({
  ok: false,
  error: { code, message },
  logs: [],
  stats: { cpuMs: 0, wallMs: 0, hostCalls: 0 },
});

function serveInvocation(stream: ServerHttp2Stream) {
  const closed = new AbortController();
  let started = false;
  let running: ReturnType<ThreadPool["run"]> | null = null;

  const send = (frame: ServerFrame) => {
    if (!stream.closed && stream.writable) stream.write(encodeFrame(frame));
  };

  const end = (result: InvocationResult) => {
    send({ t: "done", result });

    if (!stream.closed) stream.end();
  };

  stream.respond({ ":status": 200, "content-type": "application/x-ndjson" });

  stream.on("close", () => {
    closed.abort();
    running?.cancel();
  });

  stream.on("error", () => undefined);

  stream.on(
    "data",
    frameReader(
      async (raw) => {
        const frame = clientFrameSchema.safeParse(raw);

        if (!frame.success) return end(rejected("sandbox_unavailable", "Malformed frame"));

        if (frame.data.t === "host_result") {
          const { callId, ok, value, error } = frame.data;

          return running?.hostResult(callId, ok, value, error);
        }

        if (started) return;

        started = true;

        const { invocation } = frame.data;
        const release = await admission.acquire(invocation.tenantId, closed.signal);

        if (!release) return end(rejected("overloaded", "The sandbox is at capacity"));

        if (closed.signal.aborted) return release();

        running = pool.run(invocation, {
          onHostCall: (callId, name, args) => send({ t: "host_call", callId, name, args }),
        });

        const result = await running.done;

        release();

        logger.info(
          {
            tenantId: invocation.tenantId,
            invocationId: invocation.invocationId,
            ok: result.ok,
            code: result.ok ? undefined : result.error.code,
            ...result.stats,
          },
          "invocation finished",
        );

        end(result);
      },
      (error) => end(rejected("sandbox_unavailable", error.message)),
    ),
  );
}

const server = createServer();

server.on("stream", (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => {
  const path = headers[":path"];
  const method = headers[":method"];

  if (method === "GET" && path === "/health") {
    stream.respond({ ":status": 200, "content-type": "application/json" });
    stream.end(JSON.stringify({ ok: true, ...admission.load }));

    return;
  }

  if (method !== "POST" || path !== "/invoke") {
    stream.respond({ ":status": 404 });
    stream.end();

    return;
  }

  if (!authorized(headers)) {
    stream.respond({ ":status": 401 });
    stream.end();

    return;
  }

  serveInvocation(stream);
});

const port = env("SANDBOX_PORT", 4100);

server.listen(port, () => logger.info({ port, threads, perThread }, "sandbox listening"));

const shutdown = () => {
  logger.info("sandbox shutting down");
  server.close();
  void pool.close().then(() => process.exit(0));
  setTimeout(() => process.exit(1), 15_000).unref();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
