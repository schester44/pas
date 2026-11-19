import { notFound, type TenantContext } from "@pas/kernel";
import { CAPABILITY_LABELS, capabilitiesOf } from "../domain/connector";
import {
  type CarrierAssignment,
  carrierAssignmentOf,
  requiredCapabilities,
} from "../domain/ownership";
import type { CarrierDocumentRef } from "../domain/outcome";
import type { PolicyLink } from "../ports/repositories";
import { connectionClient } from "./connection-client";
import type { CarrierDeps } from "./deps";
import { toCarrierDto } from "./dto";

export interface FetchedDocument {
  title: string;
  kind: string;
  body: Uint8Array;
  contentType: string;
}

/** What other contexts ask of carriers: who writes a release, links, and carrier documents. */
export function makeCarrierServices(deps: CarrierDeps) {
  const assignment = async (
    ctx: TenantContext,
    lifecycle: Record<string, unknown>,
  ): Promise<{
    assignment: CarrierAssignment;
    carrier: ReturnType<typeof toCarrierDto>;
  } | null> => {
    const found = carrierAssignmentOf(lifecycle);

    if (!found) return null;

    const carrier = await deps.uow.run(ctx, (tx) =>
      deps.carriers.findByKey(tx, ctx, found.carrier),
    );

    if (!carrier) throw notFound("Carrier", found.carrier);

    return { assignment: found, carrier: toCarrierDto(carrier) };
  };

  const name = async (ctx: TenantContext, key: string) =>
    (await deps.uow.run(ctx, (tx) => deps.carriers.findByKey(tx, ctx, key)))?.name ?? key;

  const policyLink = (ctx: TenantContext, input: { policyId: string }) =>
    deps.uow.run(ctx, async (tx) => {
      const link = await deps.links.find(tx, ctx, input.policyId);

      if (!link) return null;

      const carrier = await deps.carriers.findById(tx, ctx, link.carrierId);

      return { ...link, carrierName: carrier?.name ?? "Carrier", carrierKey: carrier?.key ?? null };
    });

  const linkPolicy = (
    ctx: TenantContext,
    input: Omit<PolicyLink, "carrierId"> & { carrierKey: string },
  ) =>
    deps.uow.run(ctx, async (tx) => {
      const carrier = await deps.carriers.findByKey(tx, ctx, input.carrierKey);

      if (!carrier) throw notFound("Carrier", input.carrierKey);

      const existing = await deps.links.find(tx, ctx, input.policyId);
      const { carrierKey: _key, ...link } = input;

      await deps.links.save(tx, ctx, {
        ...link,
        carrierId: carrier.id,
        carrierPolicyNumber: input.carrierPolicyNumber ?? existing?.carrierPolicyNumber ?? null,
        carrierReference: input.carrierReference ?? existing?.carrierReference ?? null,
      });
    });

  /** Downloads the carrier's documents through the connection the run used. */
  const fetchDocuments = async (
    ctx: TenantContext,
    input: { flowRunId: string; documents: readonly CarrierDocumentRef[] },
  ): Promise<FetchedDocument[]> => {
    if (input.documents.length === 0) return [];

    const connection = await deps.uow.run(ctx, async (tx) => {
      const run = await deps.runs.findById(tx, ctx, input.flowRunId);

      const found = run?.connectionId
        ? await deps.carriers.findConnection(tx, ctx, run.connectionId)
        : null;

      if (!found) throw notFound("CarrierFlowRun", input.flowRunId);

      return found;
    });

    const client = connectionClient(deps, ctx, connection);

    return Promise.all(
      input.documents.map(async (doc) => {
        const url = /^https?:\/\//i.test(doc.url)
          ? doc.url
          : `${connection.baseUrl.replace(/\/+$/, "")}/${doc.url.replace(/^\/+/, "")}`;

        const result = await client.download(url);

        if (!result.ok)
          throw new Error(`Couldn't download ${doc.title} from the carrier: ${result.error}`);

        return {
          title: doc.title,
          kind: doc.kind ?? "carrier_document",
          body: result.body,
          contentType: result.contentType,
        };
      }),
    );
  };

  /** Publish check: the named carrier exists and its gateway covers what the ownership needs. */
  const verify = (ctx: TenantContext, lifecycle: Record<string, unknown>) =>
    deps.uow.run(ctx, async (tx) => {
      const found = carrierAssignmentOf(lifecycle);

      if (!found) return [];

      const carrier = await deps.carriers.findByKey(tx, ctx, found.carrier);

      if (!carrier)
        return [
          { severity: "error" as const, message: `No carrier with the key ${found.carrier}` },
        ];

      const needed = requiredCapabilities(found.ownership);

      if (carrier.mode === "file_feed") {
        return needed.length > 0
          ? [
              {
                severity: "error" as const,
                message: `${carrier.name} takes file feeds, so PAS must own rating and transactions`,
              },
            ]
          : [];
      }

      const published =
        carrier.mode === "connector"
          ? await deps.connectors.latestPublished(tx, ctx, carrier.id)
          : null;

      const supported = published
        ? capabilitiesOf(published.definition)
        : (deps.extensions.get(ctx.tenantId, carrier.extensionKey ?? "")?.capabilities ?? []);

      const missing = needed.filter((c) => !supported.includes(c));

      return missing.length > 0
        ? [
            {
              severity: "error" as const,
              message: `${carrier.name} can't ${missing.map((c) => CAPABILITY_LABELS[c].toLowerCase()).join(", ")} yet; publish a connector that does`,
            },
          ]
        : [];
    });

  return { assignment, name, policyLink, linkPolicy, fetchDocuments, verify };
}

export type CarrierServices = ReturnType<typeof makeCarrierServices>;
