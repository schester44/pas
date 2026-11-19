import {
  AggregateRoot,
  type Clock,
  conflict,
  type Instant,
  invalid,
  newId,
  type TenantId,
} from "@pas/kernel";
import { assertFilter, assertPatterns, type Subscriber } from "./matching";
import { DISABLE_AFTER } from "./retry-schedule";

export type SubscriptionKind = "webhook" | "chat";
export type SubscriptionStatus = Subscriber["status"];

/** An opaque value from the secret box; only infrastructure can open it. */
export type Sealed = Record<string, string>;

export interface SigningSecrets {
  current: Sealed;
  /** The secret before the last rotation, still signed with until it expires. */
  previous: { sealed: Sealed; expiresAt: Instant } | null;
}

export interface SubscriptionProps {
  id: string;
  tenantId: TenantId;
  kind: SubscriptionKind;
  name: string;
  url: string | null;
  eventTypes: string[];
  filter: string | null;
  status: SubscriptionStatus;
  disabledReason: string | null;
  secrets: SigningSecrets | null;
  secretHint: string | null;
  failingSince: Instant | null;
  lastSuccessAt: Instant | null;
  createdBy: string | null;
  createdAt: Instant;
  updatedAt: Instant;
}

export interface SubscriptionSettings {
  name: string;
  url: string | null;
  eventTypes: string[];
  filter: string | null;
}

/** How long the old secret keeps signing after a rotation, so receivers can switch over. */
export const ROTATION_OVERLAP = Temporal.Duration.from({ hours: 24 });

export class Subscription extends AggregateRoot {
  private constructor(private props: SubscriptionProps) {
    super();
  }

  static create(
    input: SubscriptionSettings & {
      id: string;
      tenantId: TenantId;
      kind: SubscriptionKind;
      secret: { sealed: Sealed; hint: string } | null;
      createdBy: string | null;
    },
    clock: Clock,
  ): Subscription {
    const now = clock.now();
    const settings = normalized(input, input.kind);

    if (input.kind === "webhook" && !input.secret)
      throw invalid("A webhook needs a signing secret");

    return new Subscription({
      id: input.id,
      tenantId: input.tenantId,
      kind: input.kind,
      ...settings,
      status: "active",
      disabledReason: null,
      secrets: input.secret && { current: input.secret.sealed, previous: null },
      secretHint: input.secret?.hint ?? null,
      failingSince: null,
      lastSuccessAt: null,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: SubscriptionProps): Subscription {
    return new Subscription(props);
  }

  get id(): string {
    return this.props.id;
  }

  get kind(): SubscriptionKind {
    return this.props.kind;
  }

  get isActive(): boolean {
    return this.props.status === "active";
  }

  update(settings: SubscriptionSettings, clock: Clock): void {
    this.props = {
      ...this.props,
      ...normalized(settings, this.props.kind),
      updatedAt: clock.now(),
    };
  }

  rotateSecret(secret: { sealed: Sealed; hint: string }, clock: Clock): void {
    if (this.props.kind !== "webhook" || !this.props.secrets) {
      throw conflict("Only webhooks have a signing secret");
    }

    const now = clock.now();

    this.props = {
      ...this.props,
      secrets: {
        current: secret.sealed,
        previous: { sealed: this.props.secrets.current, expiresAt: now.add(ROTATION_OVERLAP) },
      },
      secretHint: secret.hint,
      updatedAt: now,
    };
  }

  /** The secrets to sign with now, newest first. */
  signingSecrets(now: Instant): Sealed[] {
    const secrets = this.props.secrets;

    if (!secrets) return [];

    const previous =
      secrets.previous && Temporal.Instant.compare(now, secrets.previous.expiresAt) < 0
        ? [secrets.previous.sealed]
        : [];

    return [secrets.current, ...previous];
  }

  enable(clock: Clock): void {
    if (this.isActive) return;

    this.props = {
      ...this.props,
      status: "active",
      disabledReason: null,
      failingSince: null,
      updatedAt: clock.now(),
    };
  }

  disable(reason: string | null, clock: Clock): void {
    if (!this.isActive) return;

    this.props = {
      ...this.props,
      status: "disabled",
      disabledReason: reason,
      updatedAt: clock.now(),
    };
  }

  recordSuccess(clock: Clock): void {
    const now = clock.now();
    this.props = { ...this.props, failingSince: null, lastSuccessAt: now, updatedAt: now };
  }

  recordFailure(clock: Clock): void {
    if (this.props.failingSince) return;

    const now = clock.now();
    this.props = { ...this.props, failingSince: now, updatedAt: now };
  }

  /**
   * A delivery ran out of retries. If nothing has reached the destination for a day, stop
   * sending and tell the admins (PLAN §15.8).
   */
  exhausted(clock: Clock): boolean {
    const now = clock.now();
    const since = this.props.failingSince;

    if (!this.isActive || !since || Temporal.Instant.compare(since.add(DISABLE_AFTER), now) > 0) {
      return false;
    }

    this.disable("Every delivery failed for 24 hours", clock);

    this.record({
      id: newId(),
      type: "events.subscription_disabled",
      tenantId: this.props.tenantId,
      aggregateType: "event_subscription",
      aggregateId: this.props.id,
      occurredAt: now,
      payload: { subscriptionId: this.props.id, name: this.props.name, kind: this.props.kind },
    });

    return true;
  }

  toSnapshot(): Readonly<SubscriptionProps> {
    return this.props;
  }

  toSubscriber(): Subscriber {
    return {
      status: this.props.status,
      eventTypes: this.props.eventTypes,
      filter: this.props.filter,
    };
  }
}

function normalized(settings: SubscriptionSettings, kind: SubscriptionKind): SubscriptionSettings {
  const name = settings.name.trim();
  const filter = settings.filter?.trim() || null;
  const eventTypes = [...new Set(settings.eventTypes.map((t) => t.trim()).filter(Boolean))];

  if (!name) throw invalid("Name the destination");

  if (kind === "webhook" && !settings.url) throw invalid("A webhook needs an endpoint URL");

  assertPatterns(eventTypes);
  assertFilter(filter);

  return { name, url: kind === "webhook" ? settings.url : null, eventTypes, filter };
}
