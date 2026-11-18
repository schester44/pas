import { asId } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import type { IntegrationEnvironment, ProviderRules } from "./category";
import { IntegrationInstall, type InstallProps, type InstallStatus } from "./install";
import { selectProviders } from "./selection";

const rules: Record<string, ProviderRules> = {
  stripe: {
    id: "stripe",
    category: "payments",
    testMode: true,
    liveMode: true,
    builtin: false,
    requiredSecrets: [],
  },
  other_pay: {
    id: "other_pay",
    category: "payments",
    testMode: true,
    liveMode: true,
    builtin: false,
    requiredSecrets: [],
  },
  smtp: {
    id: "smtp",
    category: "email",
    testMode: false,
    liveMode: true,
    builtin: false,
    requiredSecrets: [],
  },
  census: {
    id: "census",
    category: "data",
    testMode: false,
    liveMode: true,
    builtin: false,
    requiredSecrets: [],
  },
  vendor: {
    id: "vendor",
    category: "data",
    testMode: true,
    liveMode: true,
    builtin: false,
    requiredSecrets: [],
  },
};

const at = (ms: number) => Temporal.Instant.fromEpochMilliseconds(ms);

function install(
  providerId: string,
  environment: IntegrationEnvironment,
  options: { status?: InstallStatus; enabledAt?: number; position?: number } = {},
): InstallProps {
  return {
    id: `${providerId}-${environment}`,
    tenantId: asId("t1"),
    providerId,
    category: rules[providerId]!.category,
    status: options.status ?? "enabled",
    environment,
    config: {},
    secrets: {},
    secretHints: {},
    position: options.position ?? 0,
    health: null,
    enabledAt: at(options.enabledAt ?? 1),
    createdAt: at(0),
    updatedAt: at(0),
  };
}

const select = (
  category: ProviderRules["category"],
  installs: InstallProps[],
  sandbox = false,
  fallback: string | null = "fake",
) =>
  selectProviders({ category, installs, providers: (id) => rules[id], fallback, sandbox }).map(
    (s) => s.providerId,
  );

describe("selectProviders", () => {
  it("falls back to the built-in fake when nothing is enabled", () => {
    expect(select("payments", [])).toEqual(["fake"]);

    expect(select("payments", [install("stripe", "live", { status: "disabled" })])).toEqual([
      "fake",
    ]);

    expect(select("sms", [], false, null)).toEqual([]);
  });

  it("keeps an erroring install on its port instead of silently falling back", () => {
    expect(select("payments", [install("stripe", "live", { status: "error" })])).toEqual([
      "stripe",
    ]);
  });

  it("powers a single-provider port with one install, the most recently enabled", () => {
    const installs = [
      install("stripe", "live", { enabledAt: 5 }),
      install("other_pay", "live", { enabledAt: 9 }),
    ];

    expect(select("payments", installs)).toEqual(["other_pay"]);
  });

  it("forces sandboxes onto test mode, and onto the fake for providers without one", () => {
    expect(select("payments", [install("stripe", "live")], true)).toEqual(["fake"]);
    expect(select("payments", [install("stripe", "test")], true)).toEqual(["stripe"]);
    expect(select("email", [install("smtp", "live")], true)).toEqual(["fake"]);
    expect(select("email", [install("smtp", "live")], false)).toEqual(["smtp"]);
  });

  it("chains data providers in their configured order", () => {
    const installs = [
      install("census", "live", { position: 2 }),
      install("vendor", "live", { position: 1 }),
    ];

    expect(select("data", installs)).toEqual(["vendor", "census"]);
    expect(select("data", installs, true)).toEqual(["fake"]);
  });
});

describe("IntegrationInstall in a sandbox", () => {
  const clock = { now: () => at(10), today: () => Temporal.PlainDate.from("2026-01-01") };

  it("refuses live mode and providers without a test mode", () => {
    const live = IntegrationInstall.restore(install("stripe", "live", { status: "disabled" }));
    const smtp = IntegrationInstall.restore(install("smtp", "live", { status: "disabled" }));

    expect(() => live.enable(rules.stripe!, true, clock)).toThrow("Sandboxes use test mode only");
    expect(() => smtp.enable(rules.smtp!, true, clock)).toThrow("Sandboxes use test mode only");

    const test = IntegrationInstall.restore(install("stripe", "test", { status: "disabled" }));
    test.enable(rules.stripe!, true, clock);

    expect(test.active).toBe(true);
  });
});
