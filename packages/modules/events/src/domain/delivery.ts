import { type Clock, type Instant, newId, type TenantId } from "@pas/kernel";
import { retryDelay } from "./retry-schedule";

export type DeliveryStatus = "pending" | "retrying" | "succeeded" | "failed";
export type AttemptTrigger = "automatic" | "replay" | "test";

export interface DeliveryProps {
  id: string;
  tenantId: TenantId;
  subscriptionId: string;
  eventId: string;
  eventType: string;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: Instant | null;
  lastAttemptAt: Instant | null;
  lastStatusCode: number | null;
  createdAt: Instant;
  updatedAt: Instant;
}

export interface AttemptOutcome {
  ok: boolean;
  statusCode: number | null;
}

export class Delivery {
  private constructor(private props: DeliveryProps) {}

  static create(
    input: { tenantId: TenantId; subscriptionId: string; eventId: string; eventType: string },
    clock: Clock,
  ): Delivery {
    const now = clock.now();

    return new Delivery({
      id: newId(),
      ...input,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      lastAttemptAt: null,
      lastStatusCode: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: DeliveryProps): Delivery {
    return new Delivery(props);
  }

  get id(): string {
    return this.props.id;
  }

  get attempts(): number {
    return this.props.attempts;
  }

  /** Automatic attempts run only while the delivery still waits for one. */
  get waiting(): boolean {
    return this.props.status === "pending" || this.props.status === "retrying";
  }

  /**
   * Records one attempt. Failed automatic attempts back off on the retry schedule; a replay
   * or test is a single extra try that leaves the schedule alone. Returns the wait before the
   * next automatic try, or null when there's none.
   */
  recordAttempt(
    outcome: AttemptOutcome,
    trigger: AttemptTrigger,
    clock: Clock,
  ): Temporal.Duration | null {
    const now = clock.now();
    const attempts = this.props.attempts + 1;
    const delay = outcome.ok || trigger !== "automatic" ? null : retryDelay(attempts);

    const status: DeliveryStatus = outcome.ok
      ? "succeeded"
      : delay || (trigger !== "automatic" && this.props.status === "retrying")
        ? "retrying"
        : "failed";

    this.props = {
      ...this.props,
      status,
      attempts,
      nextAttemptAt: delay
        ? now.add(delay)
        : status === "retrying"
          ? this.props.nextAttemptAt
          : null,
      lastAttemptAt: now,
      lastStatusCode: outcome.statusCode,
      updatedAt: now,
    };

    return delay;
  }

  /** Skipped because the destination was disabled before this try. */
  cancel(clock: Clock): void {
    if (this.props.status === "succeeded") return;

    this.props = { ...this.props, status: "failed", nextAttemptAt: null, updatedAt: clock.now() };
  }

  toSnapshot(): Readonly<DeliveryProps> {
    return this.props;
  }
}
