import { type Id, type Instant, invalid, type TenantId } from "@pas/kernel";

export type CarrierId = Id<"Carrier">;
export type ConnectionMode = "connector" | "file_feed";
export type CarrierEnvironment = "test" | "live";
export type CarrierStatus = "active" | "inactive";

export interface Carrier {
  id: CarrierId;
  tenantId: TenantId;
  key: string;
  name: string;
  naic: string | null;
  amBest: string | null;
  /** Jurisdiction codes such as `US-FL`. */
  admitted: string[];
  lines: string[];
  mode: ConnectionMode;
  activeEnvironment: CarrierEnvironment;
  status: CarrierStatus;
  createdAt: Instant;
  updatedAt: Instant;
}

const KEY = /^[a-z0-9][a-z0-9-]{1,62}$/;
const JURISDICTION = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;

export function assertCarrier(carrier: Pick<Carrier, "key" | "name" | "admitted" | "naic">) {
  if (!KEY.test(carrier.key)) {
    throw invalid("Use lowercase letters, numbers and dashes for the carrier key");
  }

  if (!carrier.name.trim()) throw invalid("Name the carrier");

  const bad = carrier.admitted.find((code) => !JURISDICTION.test(code));

  if (bad) throw invalid(`${bad} isn't a jurisdiction code like US-FL`);

  if (carrier.naic && !/^\d{5}$/.test(carrier.naic)) throw invalid("NAIC codes have five digits");
}

/** Sandboxes always talk to the carrier's test environment. */
export const environmentFor = (carrier: Carrier, sandbox: boolean): CarrierEnvironment =>
  sandbox ? "test" : carrier.activeEnvironment;
