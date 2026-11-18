import type { PrismaClient, PrismaTx } from "@pas/db";
import { type Clock, systemClock, type TenantId } from "@pas/kernel";
import type { TenantClockControl } from "../ports/sandbox";

const REFRESH_MS = 2_000;

/**
 * Per-tenant clocks from the sandbox offsets, held in memory so `now()` stays synchronous.
 * Offsets are re-read on an interval and on demand (before a workflow runs, after time travel).
 */
export class TenantClocks implements TenantClockControl {
  private offsets = new Map<string, number>();
  private sandboxes = new Set<string>();
  private interval: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaClient,
    readonly wall: Clock = systemClock,
  ) {}

  forTenant(tenantId: TenantId): Clock {
    const now = () => this.wall.now().add({ milliseconds: this.offsets.get(tenantId) ?? 0 });

    return { now, today: (timeZone) => now().toZonedDateTimeISO(timeZone).toPlainDate() };
  }

  /** Sandboxes always get fake providers. A sandbox created in another process shows up within one refresh. */
  isSandbox(tenantId: string): boolean {
    return this.sandboxes.has(tenantId);
  }

  async offsetMs(tenantId: string): Promise<number> {
    const row = await this.platformRead((db) =>
      db.tenantEnvironment.findUnique({
        where: { tenantId },
        select: { clockOffsetMs: true, kind: true },
      }),
    );

    const offset = Number(row?.clockOffsetMs ?? 0);
    this.offsets.set(tenantId, offset);

    if (row?.kind === "sandbox") this.sandboxes.add(tenantId);

    return offset;
  }

  async refresh(tenantId: TenantId): Promise<void> {
    await this.offsetMs(tenantId);
  }

  async start(): Promise<void> {
    await this.load();

    this.interval = setInterval(() => void this.load().catch(() => undefined), REFRESH_MS);
    this.interval.unref();
  }

  stop(): void {
    clearInterval(this.interval);
  }

  private async load(): Promise<void> {
    const rows = await this.platformRead((db) =>
      db.tenantEnvironment.findMany({
        where: { kind: "sandbox" },
        select: { tenantId: true, clockOffsetMs: true },
      }),
    );

    this.offsets = new Map(rows.map((r) => [r.tenantId, Number(r.clockOffsetMs)]));
    this.sandboxes = new Set(rows.map((r) => r.tenantId));
  }

  private platformRead<T>(work: (db: PrismaTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (db) => {
      await db.$executeRaw`select set_config('app.platform_read', 'on', true)`;

      return work(db);
    });
  }
}
