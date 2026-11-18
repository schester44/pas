import {
  AggregateRoot,
  type Clock,
  DomainError,
  type Instant,
  invalid,
  newId,
  type TenantId,
} from "@pas/kernel";
import {
  type IntegrationCategory,
  type IntegrationEnvironment,
  type ProviderRules,
  usableInSandbox,
} from "./category";

export type InstallStatus = "enabled" | "disabled" | "error";

/** One AES-256-GCM sealed value; `keyId` names the key that sealed it so keys can rotate. */
export interface SealedSecret {
  keyId: string;
  iv: string;
  data: string;
  tag: string;
}

export interface HealthCheck {
  checkedAt: Instant;
  ok: boolean;
  detail: string;
}

export interface InstallProps {
  id: string;
  tenantId: TenantId;
  providerId: string;
  category: IntegrationCategory;
  status: InstallStatus;
  environment: IntegrationEnvironment;
  config: Record<string, unknown>;
  secrets: Record<string, SealedSecret>;
  secretHints: Record<string, string>;
  position: number;
  health: HealthCheck | null;
  enabledAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
}

const sandboxOnly = () =>
  new DomainError("forbidden", "Sandboxes use test mode only", { field: "environment" });

/** A tenant's install of a catalog provider (PLAN §19 decision 13). */
export class IntegrationInstall extends AggregateRoot {
  private constructor(private props: InstallProps) {
    super();
  }

  static create(
    tenantId: TenantId,
    provider: ProviderRules,
    environment: IntegrationEnvironment,
    clock: Clock,
  ): IntegrationInstall {
    const now = clock.now();

    return new IntegrationInstall({
      id: newId(),
      tenantId,
      providerId: provider.id,
      category: provider.category,
      status: "disabled",
      environment,
      config: {},
      secrets: {},
      secretHints: {},
      position: 0,
      health: null,
      enabledAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: InstallProps): IntegrationInstall {
    return new IntegrationInstall(props);
  }

  get id(): string {
    return this.props.id;
  }

  get providerId(): string {
    return this.props.providerId;
  }

  get category(): IntegrationCategory {
    return this.props.category;
  }

  get active(): boolean {
    return this.props.status !== "disabled";
  }

  configure(
    provider: ProviderRules,
    input: {
      environment: IntegrationEnvironment;
      config: Record<string, unknown>;
      secrets: Record<string, { sealed: SealedSecret; hint: string }>;
      position?: number;
    },
    sandbox: boolean,
    clock: Clock,
  ): void {
    this.assertEnvironment(provider, input.environment, sandbox);

    const sealed = Object.fromEntries(Object.entries(input.secrets).map(([k, v]) => [k, v.sealed]));
    const hints = Object.fromEntries(Object.entries(input.secrets).map(([k, v]) => [k, v.hint]));

    this.props = {
      ...this.props,
      environment: input.environment,
      config: input.config,
      secrets: { ...this.props.secrets, ...sealed },
      secretHints: { ...this.props.secretHints, ...hints },
      position: input.position ?? this.props.position,
      updatedAt: clock.now(),
    };

    if (this.active) this.changed("configured", clock);
  }

  enable(provider: ProviderRules, sandbox: boolean, clock: Clock): void {
    this.assertEnvironment(provider, this.props.environment, sandbox);

    const missing = provider.requiredSecrets.filter((key) => !this.props.secrets[key]);

    if (missing.length > 0) {
      throw invalid("Add the required secrets before enabling", { fields: missing });
    }

    if (this.active) return;

    const now = clock.now();
    this.props = { ...this.props, status: "enabled", enabledAt: now, updatedAt: now };
    this.changed("enabled", clock);
  }

  disable(clock: Clock): void {
    if (!this.active) return;

    this.props = { ...this.props, status: "disabled", updatedAt: clock.now() };
    this.changed("disabled", clock);
  }

  /** A failing check flags an active install; it keeps powering its port so calls fail loudly, never silently fall back. */
  recordHealth(ok: boolean, detail: string, clock: Clock): void {
    const now = clock.now();
    const status = !this.active ? "disabled" : ok ? "enabled" : "error";

    this.props = {
      ...this.props,
      status,
      health: { checkedAt: now, ok, detail },
      updatedAt: now,
    };
  }

  toSnapshot(): Readonly<InstallProps> {
    return this.props;
  }

  private assertEnvironment(
    provider: ProviderRules,
    environment: IntegrationEnvironment,
    sandbox: boolean,
  ): void {
    if (sandbox && !usableInSandbox(provider, environment)) throw sandboxOnly();

    if (environment === "live" && !provider.liveMode) {
      throw invalid(`This provider has no live mode`, { field: "environment" });
    }

    if (environment === "test" && !provider.testMode) {
      throw invalid(`This provider has no test mode`, { field: "environment" });
    }
  }

  private changed(change: string, clock: Clock): void {
    this.record({
      id: newId(),
      type: "integrations.install_changed",
      tenantId: this.props.tenantId,
      aggregateType: "integration_install",
      aggregateId: this.props.id,
      occurredAt: clock.now(),
      payload: { providerId: this.props.providerId, category: this.props.category, change },
    });
  }
}
