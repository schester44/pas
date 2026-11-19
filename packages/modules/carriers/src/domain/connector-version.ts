import { conflict, type Id, type Instant, type TenantId } from "@pas/kernel";
import type { CarrierId } from "./carrier";
import type { Capability, ConnectorDefinition } from "./connector";

export type ConnectorVersionId = Id<"CarrierConnectorVersion">;
export type ConnectorStatus = "draft" | "published" | "retired";

export interface FixtureResult {
  fixtureId: string;
  name: string;
  capability: Capability;
  passed: boolean;
  problems: string[];
}

export interface TestReport {
  ranAt: string;
  passed: boolean;
  results: FixtureResult[];
  missing: Capability[];
}

export interface ConnectorVersion {
  id: ConnectorVersionId;
  tenantId: TenantId;
  carrierId: CarrierId;
  version: number;
  status: ConnectorStatus;
  definition: ConnectorDefinition;
  contentHash: string | null;
  testReport: TestReport | null;
  note: string | null;
  createdAt: Instant;
  updatedAt: Instant;
  publishedAt: Instant | null;
}

export function assertDraft(version: ConnectorVersion) {
  if (version.status !== "draft") {
    throw conflict(
      `Connector version ${version.version} is ${version.status}; copy it to a new draft to change it`,
      { reason: "connector_published" },
    );
  }
}
