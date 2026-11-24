import { newId } from "@pas/kernel";
import { type ClientHttp2Session, connect, constants } from "node:http2";
import type { ExtensionSandbox, InvokeRequest } from "../index";
import {
  defaultSandboxLimits,
  encodeFrame,
  frameReader,
  type Invocation,
  type InvocationResult,
  type SandboxErrorCode,
  serverFrameSchema,
} from "../protocol";

/** Grace past the extension's own wall limit before the caller gives up on the service. */
const BACKSTOP_MS = 5_000;

const failed = (code: SandboxErrorCode, message: string): InvocationResult => ({
  ok: false,
  error: { code, message },
  logs: [],
  stats: { cpuMs: 0, wallMs: 0, hostCalls: 0 },
});

/**
 * Talks to `apps/sandbox` over one multiplexed HTTP/2 connection. Each invocation is a stream of
 * newline-delimited frames: the sandbox asks for host calls and this side performs them.
 */
export class HttpSandboxClient implements ExtensionSandbox {
  private session: ClientHttp2Session | null = null;

  constructor(private readonly options: { url: string; token: string }) {}

  private connection(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed) return this.session;

    const session = connect(this.options.url);

    session.on("error", () => undefined);

    session.on("close", () => {
      if (this.session === session) this.session = null;
    });

    session.unref();
    this.session = session;

    return session;
  }

  close(): void {
    this.session?.close();
    this.session = null;
  }

  invoke(request: InvokeRequest): Promise<InvocationResult> {
    const host = request.host ?? {};

    const invocation: Invocation = {
      invocationId: request.invocationId ?? newId(),
      tenantId: request.tenantId,
      code: request.code,
      entry: request.entry ?? "default",
      input: request.input ?? null,
      hostFunctions: Object.keys(host),
      limits: { ...defaultSandboxLimits, ...request.limits },
    };

    return new Promise((resolve) => {
      let settled = false;
      let stream: ReturnType<ClientHttp2Session["request"]>;

      const finish = (result: InvocationResult) => {
        if (settled) return;

        settled = true;
        clearTimeout(backstop);
        request.signal?.removeEventListener("abort", onAbort);

        if (!stream.closed) stream.close(constants.NGHTTP2_CANCEL);

        resolve(result);
      };

      const onAbort = () => finish(failed("timeout", "The invocation was cancelled"));

      const backstop = setTimeout(
        () => finish(failed("timeout", "The sandbox didn't answer in time")),
        invocation.limits.wallMs + BACKSTOP_MS,
      );

      try {
        stream = this.connection().request({
          ":method": "POST",
          ":path": "/invoke",
          authorization: `Bearer ${this.options.token}`,
          "content-type": "application/x-ndjson",
        });
      } catch (error) {
        clearTimeout(backstop);

        resolve(
          failed("sandbox_unavailable", error instanceof Error ? error.message : String(error)),
        );

        return;
      }

      const reply = (frame: Parameters<typeof encodeFrame>[0]) => {
        if (!settled && stream.writable) stream.write(encodeFrame(frame));
      };

      const callHost = async (callId: number, name: string, args: unknown) => {
        const fn = host[name];

        try {
          if (!fn) throw new Error(`Host function ${name} isn't offered`);

          reply({ t: "host_result", callId, ok: true, value: (await fn(args)) ?? null });
        } catch (error) {
          reply({
            t: "host_result",
            callId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      };

      const read = frameReader(
        (raw) => {
          const frame = serverFrameSchema.safeParse(raw);

          if (!frame.success)
            return finish(failed("sandbox_unavailable", "Malformed frame from the sandbox"));

          if (frame.data.t === "done") return finish(frame.data.result);

          void callHost(frame.data.callId, frame.data.name, frame.data.args);
        },
        (error) => finish(failed("sandbox_unavailable", error.message)),
      );

      stream.on("response", (headers) => {
        const status = Number(headers[":status"]);

        if (status !== 200) finish(failed("sandbox_unavailable", `The sandbox answered ${status}`));
      });

      stream.on("data", read);
      stream.on("error", (error) => finish(failed("sandbox_unavailable", error.message)));

      stream.on("close", () =>
        finish(failed("sandbox_unavailable", "The sandbox closed the stream")),
      );

      request.signal?.addEventListener("abort", onAbort, { once: true });
      stream.write(encodeFrame({ t: "invoke", invocation }));
    });
  }
}
