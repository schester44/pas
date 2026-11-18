import {
  AggregateRoot,
  conflict,
  type Clock,
  type Instant,
  invalid,
  newId,
  type TenantId,
} from "@pas/kernel";

export type EnvironmentKind = "production" | "sandbox";

export interface TenantEnvironmentProps {
  tenantId: TenantId;
  kind: EnvironmentKind;
  parentTenantId: TenantId | null;
  clockOffsetMs: number;
  createdAt: Instant;
  updatedAt: Instant;
}

/** Production is the default and its clock never moves; sandboxes travel forward only. */
export class TenantEnvironment extends AggregateRoot {
  private constructor(private props: TenantEnvironmentProps) {
    super();
  }

  static sandbox(tenantId: TenantId, parentTenantId: TenantId, clock: Clock): TenantEnvironment {
    const now = clock.now();

    const environment = new TenantEnvironment({
      tenantId,
      kind: "sandbox",
      parentTenantId,
      clockOffsetMs: 0,
      createdAt: now,
      updatedAt: now,
    });

    environment.record({
      id: newId(),
      type: "tenants.sandbox_created",
      tenantId: parentTenantId,
      aggregateType: "tenant_environment",
      aggregateId: tenantId,
      occurredAt: now,
      payload: { sandboxTenantId: tenantId },
    });

    return environment;
  }

  static restore(props: TenantEnvironmentProps): TenantEnvironment {
    return new TenantEnvironment(props);
  }

  get tenantId(): TenantId {
    return this.props.tenantId;
  }

  get isSandbox(): boolean {
    return this.props.kind === "sandbox";
  }

  /** Moves the sandbox clock so its "now" is `target` while the wall clock reads `wallNow`. */
  travelTo(target: Instant, wallNow: Instant): void {
    if (!this.isSandbox) throw conflict("Only a sandbox's clock can move.");

    const current = wallNow.add({ milliseconds: this.props.clockOffsetMs });

    if (Temporal.Instant.compare(target, current) < 0) {
      throw invalid("Sandbox time only moves forward.", { field: "to" });
    }

    this.props = {
      ...this.props,
      clockOffsetMs: target.epochMilliseconds - wallNow.epochMilliseconds,
      updatedAt: wallNow,
    };
  }

  recordAdvance(from: Instant, to: Instant, fired: number): void {
    this.record({
      id: newId(),
      type: "tenants.sandbox_time_advanced",
      tenantId: this.props.tenantId,
      aggregateType: "tenant_environment",
      aggregateId: this.props.tenantId,
      occurredAt: to,
      payload: { from: from.toString(), to: to.toString(), fired },
    });
  }

  toSnapshot(): Readonly<TenantEnvironmentProps> {
    return this.props;
  }
}
