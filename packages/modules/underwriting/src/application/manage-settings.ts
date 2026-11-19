import { invalid, type TenantContext } from "@pas/kernel";
import type { UnderwritingSettings } from "../domain/settings";
import type { UnderwritingDeps } from "./deps";

const decimal = /^\d+(\.\d+)?$/;

function validate(settings: UnderwritingSettings) {
  const keys = new Set<string>();

  for (const p of settings.authorityProfiles) {
    if (keys.has(p.key)) throw invalid(`Two authority profiles use ${p.key}`, { field: "key" });

    keys.add(p.key);

    for (const limit of [p.maxPremium, p.maxInsuredValue]) {
      if (limit !== null && !decimal.test(limit)) throw invalid(`${limit} isn't an amount`);
    }
  }

  const codes = new Set(settings.declineReasons.map((r) => r.code));

  if (codes.size !== settings.declineReasons.length) throw invalid("Decline reason codes repeat");
}

/** Tenant underwriting config: authority profiles, decline reasons, overdue consequence. */
export function makeManageSettings(deps: Pick<UnderwritingDeps, "uow" | "settings">) {
  return {
    get: (ctx: TenantContext) => deps.uow.run(ctx, (tx) => deps.settings.get(tx, ctx)),
    async update(ctx: TenantContext, settings: UnderwritingSettings) {
      validate(settings);
      await deps.uow.run(ctx, (tx) => deps.settings.save(tx, ctx, settings));

      return settings;
    },
  };
}
