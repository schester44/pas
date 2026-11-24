import {
  conflict,
  invalid,
  newId,
  notFound,
  type TenantContext,
  type Transaction,
} from "@pas/kernel";
import {
  assertCarrier,
  type Carrier,
  type CarrierEnvironment,
  type ConnectionMode,
} from "../domain/carrier";
import {
  type CallbackSettings,
  type CarrierConnection,
  type ConnectionAuth,
  hintOf,
  SECRET_FIELDS,
  type SecretField,
  secretContext,
} from "../domain/connection";
import { capabilitiesOf } from "../domain/connector";
import type { CarrierDeps } from "./deps";
import { toCarrierDto, toConnectionDto, toVersionDto } from "./dto";

export interface CarrierInput {
  key: string;
  name: string;
  naic?: string | null;
  amBest?: string | null;
  admitted: string[];
  lines: string[];
  mode: ConnectionMode;
  activeEnvironment: CarrierEnvironment;
  status?: Carrier["status"];
}

export interface ConnectionInput {
  carrierId: string;
  environment: CarrierEnvironment;
  baseUrl: string;
  auth: ConnectionAuth;
  callback: CallbackSettings;
  /** Empty string clears a secret; an omitted field keeps the stored value. */
  secrets: Partial<Record<SecretField, string>>;
}

export async function loadCarrier(
  deps: Pick<CarrierDeps, "carriers">,
  tx: Transaction,
  ctx: TenantContext,
  id: string,
): Promise<Carrier> {
  const carrier = await deps.carriers.findById(tx, ctx, id);

  if (!carrier) throw notFound("Carrier", id);

  return carrier;
}

export function makeManageCarriers(deps: CarrierDeps) {
  const list = (ctx: TenantContext) =>
    deps.uow.run(ctx, async (tx) => {
      const carriers = await deps.carriers.list(tx, ctx);

      return Promise.all(
        carriers.map(async (carrier) => {
          const published = await deps.connectors.latestPublished(tx, ctx, carrier.id);
          const connections = await deps.carriers.connections(tx, ctx, carrier.id);

          return {
            ...toCarrierDto(carrier),
            connector: published && {
              version: published.version,
              capabilities: capabilitiesOf(published.definition),
            },
            environments: connections.map((c) => c.environment),
          };
        }),
      );
    });

  const get = (ctx: TenantContext, input: { id: string }) =>
    deps.uow.run(ctx, async (tx) => {
      const carrier = await loadCarrier(deps, tx, ctx, input.id);
      const connections = await deps.carriers.connections(tx, ctx, carrier.id);
      const versions = await deps.connectors.versions(tx, ctx, carrier.id);

      return {
        ...toCarrierDto(carrier),
        connections: connections.map((c) => toConnectionDto(c, deps.publicUrl)),
        versions: versions.map((v) => {
          const { definition: _definition, ...summary } = toVersionDto(v);

          return summary;
        }),
      };
    });

  const save = (ctx: TenantContext, input: CarrierInput & { id?: string }) =>
    deps.uow.run(ctx, async (tx) => {
      const now = deps.clocks.forTenant(ctx.tenantId).now();
      const existing = input.id ? await loadCarrier(deps, tx, ctx, input.id) : null;
      const clash = await deps.carriers.findByKey(tx, ctx, input.key);

      if (clash && clash.id !== existing?.id)
        throw conflict(`Another carrier uses the key ${input.key}`);

      const carrier: Carrier = {
        id: existing?.id ?? newId(),
        tenantId: ctx.tenantId,
        key: input.key.trim(),
        name: input.name.trim(),
        naic: input.naic?.trim() || null,
        amBest: input.amBest?.trim() || null,
        admitted: [
          ...new Set(input.admitted.map((code) => code.trim().toUpperCase()).filter(Boolean)),
        ],
        lines: [...new Set(input.lines.map((line) => line.trim()).filter(Boolean))],
        mode: input.mode,
        activeEnvironment: input.activeEnvironment,
        status: input.status ?? existing?.status ?? "active",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      assertCarrier(carrier);
      await deps.carriers.save(tx, carrier);

      return toCarrierDto(carrier);
    });

  const saveConnection = (ctx: TenantContext, input: ConnectionInput) =>
    deps.uow.run(ctx, async (tx) => {
      const carrier = await loadCarrier(deps, tx, ctx, input.carrierId);

      const existing = (await deps.carriers.connections(tx, ctx, carrier.id)).find(
        (c) => c.environment === input.environment,
      );

      const now = deps.clocks.forTenant(ctx.tenantId).now();

      if (!URL.canParse(input.baseUrl))
        throw invalid("Enter the carrier's base URL, e.g. https://api.carrier.com/v1");

      const connection: CarrierConnection = {
        id: existing?.id ?? newId(),
        tenantId: ctx.tenantId,
        carrierId: carrier.id,
        environment: input.environment,
        baseUrl: input.baseUrl.trim(),
        auth: input.auth,
        secrets: { ...existing?.secrets },
        secretHints: { ...existing?.secretHints },
        callback: input.callback,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      for (const field of SECRET_FIELDS) {
        const value = input.secrets[field];

        if (value === undefined) continue;

        if (value === "") {
          delete connection.secrets[field];
          delete connection.secretHints[field];
          continue;
        }

        connection.secrets[field] = deps.secrets.seal(value, secretContext(connection, field));
        connection.secretHints[field] = hintOf(field, value);
      }

      await deps.carriers.saveConnection(tx, connection);
      deps.tokens.delete(connection.id);

      return toConnectionDto(connection, deps.publicUrl);
    });

  return { list, get, save, saveConnection };
}

export type ManageCarriers = ReturnType<typeof makeManageCarriers>;
