interface Waiter {
  tenantId: string;
  grant(release: () => void): void;
}

/**
 * Caps concurrent invocations overall and per tenant, so one tenant's burst queues behind its
 * own cap instead of taking every slot. Waiters past either queue cap are turned away, so a
 * tenant's burst can't fill the queue for everyone else.
 */
export class Admission {
  private running = 0;
  private readonly perTenant = new Map<string, number>();
  private readonly queue: Waiter[] = [];

  constructor(
    private readonly limits: {
      total: number;
      perTenant: number;
      maxQueued: number;
      maxQueuedPerTenant: number;
    },
  ) {}

  private eligible(tenantId: string) {
    return (
      this.running < this.limits.total &&
      (this.perTenant.get(tenantId) ?? 0) < this.limits.perTenant
    );
  }

  private take(tenantId: string): () => void {
    this.running += 1;
    this.perTenant.set(tenantId, (this.perTenant.get(tenantId) ?? 0) + 1);

    let released = false;

    return () => {
      if (released) return;

      released = true;
      this.running -= 1;

      const left = (this.perTenant.get(tenantId) ?? 1) - 1;

      if (left === 0) this.perTenant.delete(tenantId);
      else this.perTenant.set(tenantId, left);

      this.drain();
    };
  }

  private drain() {
    for (let i = 0; i < this.queue.length;) {
      const waiter = this.queue[i]!;

      if (this.eligible(waiter.tenantId)) {
        this.queue.splice(i, 1);
        waiter.grant(this.take(waiter.tenantId));
      } else {
        i += 1;
      }
    }
  }

  /** Resolves with a release function, or `null` when the queue is full or the wait is aborted. */
  acquire(tenantId: string, signal: AbortSignal): Promise<(() => void) | null> {
    if (this.eligible(tenantId)) return Promise.resolve(this.take(tenantId));

    const queuedForTenant = this.queue.filter((w) => w.tenantId === tenantId).length;

    if (
      this.queue.length >= this.limits.maxQueued ||
      queuedForTenant >= this.limits.maxQueuedPerTenant
    ) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const waiter: Waiter = {
        tenantId,
        grant: (release) => {
          signal.removeEventListener("abort", onAbort);
          resolve(release);
        },
      };

      const onAbort = () => {
        const index = this.queue.indexOf(waiter);

        if (index !== -1) this.queue.splice(index, 1);

        resolve(null);
      };

      signal.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
    });
  }

  get load() {
    return { running: this.running, queued: this.queue.length };
  }
}
