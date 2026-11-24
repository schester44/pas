import type { ExtensionSandbox } from "@pas/sandbox";
import {
  clockHost,
  type FetchArgs,
  type FetchResult,
  fetchHost,
  fixtureFetch,
  guardedFetch,
  hostAllowed,
  type NetworkExchange,
  recordingFetch,
  stepHost,
} from "@pas/sandbox/client";
import type { ExtensionRunner, RunnerRequest, RunnerResult } from "../ports/services";

const MB = 1024 * 1024;

/** The ExtensionRunner over the sandbox service; network, clock and steps are served from here. */
export class SandboxExtensionRunner implements ExtensionRunner {
  constructor(
    private readonly sandbox: ExtensionSandbox,
    private readonly options: { allowPrivateNetwork?: boolean } = {},
  ) {}

  async run(request: RunnerRequest): Promise<RunnerResult> {
    const exchanges: NetworkExchange[] = [];
    const { network } = request;

    const live = (args: FetchArgs): Promise<FetchResult> =>
      guardedFetch(args, {
        allowedHosts: network.allowedHosts,
        allowPrivateNetwork: this.options.allowPrivateNetwork ?? false,
        credentials: (url) =>
          Object.fromEntries(
            network.credentials
              .filter((rule) => hostAllowed(url.hostname, [rule.host]))
              .map((rule) => [rule.header.toLowerCase(), rule.value]),
          ),
      });

    const fetch = recordingFetch(
      network.mode === "fixtures" ? fixtureFetch(network.fixtures) : live,
      (exchange) => exchanges.push(exchange),
    );

    const result = await this.sandbox.invoke({
      tenantId: request.ctx.tenantId,
      invocationId: request.invocationId,
      code: request.code,
      entry: request.entry,
      input: request.input,
      host: {
        ...fetchHost(fetch),
        ...clockHost(request.clock),
        ...(request.step && stepHost(request.step)),
        ...request.services,
      },
      limits: {
        wallMs: request.limits.wallMs,
        ...(request.limits.cpuMs && { cpuMs: request.limits.cpuMs }),
        ...(request.limits.memoryMb && { memoryBytes: request.limits.memoryMb * MB }),
      },
      ...(request.signal && { signal: request.signal }),
    });

    return {
      ok: result.ok,
      output: result.ok ? result.output : null,
      error: result.ok ? null : result.error,
      logs: result.logs,
      stats: result.stats,
      network: exchanges,
    };
  }
}
