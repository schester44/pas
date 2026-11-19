import { createHash } from "node:crypto";
import {
  canonicalJson,
  DomainError,
  newId,
  notFound,
  type TenantContext,
  type Transaction,
} from "@pas/kernel";
import { capabilitiesOf, type ConnectorDefinition, emptyConnector } from "../domain/connector";
import { checkConnector } from "../domain/connector-checks";
import { assertDraft, type ConnectorVersion, type TestReport } from "../domain/connector-version";
import type { Fixture } from "../domain/fixture";
import type { CarrierDeps } from "./deps";
import { toFixtureDto, toVersionDto } from "./dto";
import { loadCarrier } from "./manage-carriers";
import { replayFixture } from "./replay-fixture";

async function loadVersion(deps: CarrierDeps, tx: Transaction, ctx: TenantContext, id: string) {
  const version = await deps.connectors.findVersion(tx, ctx, id);

  if (!version) throw notFound("Connector version", id);

  return version;
}

/** Every fixture replayed against the definition; each configured capability needs one. */
export async function runSuite(
  definition: ConnectorDefinition,
  fixtures: readonly Fixture[],
  ranAt: string,
): Promise<TestReport> {
  const capabilities = capabilitiesOf(definition);
  const relevant = fixtures.filter((f) => capabilities.includes(f.capability));

  const results = await Promise.all(
    relevant.map(async (fixture) => ({
      fixtureId: fixture.id,
      name: fixture.name,
      capability: fixture.capability,
      ...(await replayFixture(definition, fixture)),
    })),
  );

  const missing = capabilities.filter((c) => !relevant.some((f) => f.capability === c));

  return {
    ranAt,
    passed: missing.length === 0 && results.every((r) => r.passed),
    results,
    missing,
  };
}

export function makeManageConnector(deps: CarrierDeps) {
  const now = (ctx: TenantContext) => deps.clocks.forTenant(ctx.tenantId).now();

  const get = (ctx: TenantContext, input: { id: string }) =>
    deps.uow.run(ctx, async (tx) => {
      const version = await loadVersion(deps, tx, ctx, input.id);

      return { ...toVersionDto(version), issues: checkConnector(version.definition) };
    });

  const createDraft = (ctx: TenantContext, input: { carrierId: string; copyFromId?: string }) =>
    deps.uow.run(ctx, async (tx) => {
      const carrier = await loadCarrier(deps, tx, ctx, input.carrierId);
      const versions = await deps.connectors.versions(tx, ctx, carrier.id);
      const open = versions.find((v) => v.status === "draft");

      if (open) return toVersionDto(open);

      const source = input.copyFromId
        ? versions.find((v) => v.id === input.copyFromId)
        : versions.toSorted((a, b) => b.version - a.version)[0];

      const version: ConnectorVersion = {
        id: newId(),
        tenantId: ctx.tenantId,
        carrierId: carrier.id,
        version: Math.max(0, ...versions.map((v) => v.version)) + 1,
        status: "draft",
        definition: source ? structuredClone(source.definition) : emptyConnector(),
        contentHash: null,
        testReport: null,
        note: null,
        createdAt: now(ctx),
        updatedAt: now(ctx),
        publishedAt: null,
      };

      await deps.connectors.saveVersion(tx, version);

      return toVersionDto(version);
    });

  const update = (
    ctx: TenantContext,
    input: { id: string; definition: ConnectorDefinition; note?: string | null },
  ) =>
    deps.uow.run(ctx, async (tx) => {
      const version = await loadVersion(deps, tx, ctx, input.id);

      assertDraft(version);

      const next: ConnectorVersion = {
        ...version,
        definition: input.definition,
        ...(input.note !== undefined && { note: input.note }),
        testReport: null,
        updatedAt: now(ctx),
      };

      await deps.connectors.saveVersion(tx, next);

      return { ...toVersionDto(next), issues: checkConnector(next.definition) };
    });

  const test = (ctx: TenantContext, input: { id: string }) =>
    deps.uow.run(ctx, async (tx) => {
      const version = await loadVersion(deps, tx, ctx, input.id);
      const fixtures = await deps.connectors.fixtures(tx, ctx, version.carrierId);
      const report = await runSuite(version.definition, fixtures, now(ctx).toString());

      if (version.status === "draft") {
        await deps.connectors.saveVersion(tx, {
          ...version,
          testReport: report,
          updatedAt: now(ctx),
        });
      }

      return report;
    });

  const publish = (ctx: TenantContext, input: { id: string; note?: string }) =>
    deps.uow.run(ctx, async (tx) => {
      const version = await loadVersion(deps, tx, ctx, input.id);

      assertDraft(version);

      const errors = checkConnector(version.definition).filter((i) => i.severity === "error");

      if (errors.length > 0) {
        throw new DomainError(
          "precondition_failed",
          `Fix ${errors.length} problem${errors.length === 1 ? "" : "s"} before publishing`,
          {
            reason: "connector_invalid",
          },
        );
      }

      const fixtures = await deps.connectors.fixtures(tx, ctx, version.carrierId);
      const report = await runSuite(version.definition, fixtures, now(ctx).toString());

      if (!report.passed) {
        const failing = report.results.filter((r) => !r.passed).length;

        throw new DomainError(
          "precondition_failed",
          report.missing.length > 0
            ? `Record a fixture for ${report.missing.join(", ")} before publishing`
            : `${failing} fixture${failing === 1 ? "" : "s"} failed; fix the flow or re-record`,
          { reason: "connector_tests_failed" },
        );
      }

      for (const other of await deps.connectors.versions(tx, ctx, version.carrierId)) {
        if (other.status === "published") {
          await deps.connectors.saveVersion(tx, {
            ...other,
            status: "retired",
            updatedAt: now(ctx),
          });
        }
      }

      const published: ConnectorVersion = {
        ...version,
        status: "published",
        contentHash: createHash("sha256").update(canonicalJson(version.definition)).digest("hex"),
        testReport: report,
        note: input.note?.trim() || version.note,
        publishedAt: now(ctx),
        updatedAt: now(ctx),
      };

      await deps.connectors.saveVersion(tx, published);

      return toVersionDto(published);
    });

  const fixtures = (ctx: TenantContext, input: { carrierId: string }) =>
    deps.uow.run(ctx, async (tx) =>
      (await deps.connectors.fixtures(tx, ctx, input.carrierId)).map(toFixtureDto),
    );

  const saveFixture = (ctx: TenantContext, input: { flowRunId: string; name: string }) =>
    deps.uow.run(ctx, async (tx) => {
      const run = await deps.runs.findById(tx, ctx, input.flowRunId);

      if (!run) throw notFound("CarrierFlowRun", input.flowRunId);

      if (run.status !== "succeeded" && run.status !== "failed") {
        throw new DomainError("precondition_failed", "Wait for the run to finish before saving it");
      }

      const exchanges = await deps.runs.exchanges(tx, ctx, run.id);

      const fixture: Fixture = {
        id: newId(),
        carrierId: run.carrierId,
        capability: run.capability,
        name: input.name.trim() || `${run.capability} ${run.startedAt.toString().slice(0, 16)}`,
        input: run.input,
        exchanges: exchanges
          .filter((e) => e.kind !== "callback")
          .map((e) => ({
            stepId: e.stepId,
            method: e.request.method ?? "GET",
            url: e.request.url ?? "",
            response: e.response,
            error: e.response ? null : e.error,
          })),
        callbacks: exchanges
          .filter((e) => e.kind === "callback")
          .map((e) => ({ body: e.request.body ?? null })),
        expected: run.output?.outcome ?? { status: "failed", documents: [], messages: [] },
        createdAt: now(ctx),
      };

      await deps.connectors.saveFixture(tx, ctx, fixture);

      return toFixtureDto(fixture);
    });

  const deleteFixture = (ctx: TenantContext, input: { id: string }) =>
    deps.uow.run(ctx, (tx) => deps.connectors.deleteFixture(tx, ctx, input.id));

  return { get, createDraft, update, test, publish, fixtures, saveFixture, deleteFixture };
}

export type ManageConnector = ReturnType<typeof makeManageConnector>;
