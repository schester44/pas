import { injectTraceContext, withExtractedContext, type Logger } from "@pas/observability";
import { PgBoss, type ConstructorOptions, type Job, type SendOptions } from "pg-boss";
import type { QueueDefinition, QueuePayload } from "./define";

const TRACE_KEY = "_trace";

type Envelope = Record<string, unknown> & { [TRACE_KEY]?: Record<string, string> };

/** Thin typed wrapper around pg-boss. Only composition roots construct it. */
export class QueueClient {
  readonly boss: PgBoss;
  private started: Promise<unknown> | undefined;

  constructor(
    options: ConstructorOptions,
    private readonly logger: Logger,
  ) {
    this.boss = new PgBoss(options);
    this.boss.on("error", (error) => this.logger.error({ err: error }, "pg-boss error"));
  }

  start(): Promise<unknown> {
    this.started ??= this.boss.start();

    return this.started;
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true });
  }

  /** Create queues that don't exist yet. Call once at startup with every definition you use. */
  async ensureQueues(definitions: readonly QueueDefinition[]): Promise<void> {
    await this.start();

    for (const definition of definitions) {
      const existing = await this.boss.getQueue(definition.name);

      if (!existing) await this.boss.createQueue(definition.name, definition.queueOptions);
    }
  }

  async send<Q extends QueueDefinition>(
    queue: Q,
    data: QueuePayload<Q>,
    options?: SendOptions,
  ): Promise<string | null> {
    await this.start();
    const payload = queue.schema.parse(data) as Record<string, unknown>;

    return this.boss.send(
      queue.name,
      { ...payload, [TRACE_KEY]: injectTraceContext() },
      { ...queue.sendOptions, ...options },
    );
  }

  /** Register a handler. Payloads are validated; each job runs in a span continuing the producer's trace. */
  async work<Q extends QueueDefinition>(
    queue: Q,
    handler: (data: QueuePayload<Q>, job: Job<Envelope>) => Promise<void>,
  ): Promise<string> {
    await this.start();

    return this.boss.work<Envelope>(queue.name, async (jobs) => {
      for (const job of jobs) {
        const { [TRACE_KEY]: carrier, ...rest } = job.data;

        await withExtractedContext(carrier, `job ${queue.name}`, async (span) => {
          span.setAttribute("job.id", job.id);
          span.setAttribute("job.retry_count", job.retryCount);
          await handler(queue.schema.parse(rest) as QueuePayload<Q>, job);
        });
      }
    });
  }

  async schedule<Q extends QueueDefinition>(queue: Q, cron: string, data: QueuePayload<Q>) {
    await this.start();
    await this.boss.schedule(queue.name, cron, queue.schema.parse(data) as object);
  }
}
