import { createHmac, timingSafeEqual } from "node:crypto";
import { asId, DomainError, notFound, type TenantContext } from "@pas/kernel";
import { secretContext } from "../domain/connection";
import { evaluateMapping } from "../domain/mapping";
import type { CarrierDeps } from "./deps";

const forbidden = (message: string) => new DomainError("forbidden", message);

function verify(secret: string, rawBody: string, signature: string | null): boolean {
  if (!signature) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const given = signature.replace(/^sha256=/, "");

  return (
    given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  );
}

/**
 * `POST /api/carriers/callbacks/:connectionId`: verifies the signature, finds the correlation key
 * with the connector's mapping and resumes the waiting run (or parks the callback until it waits).
 */
export function makeReceiveCallback(deps: CarrierDeps) {
  return async function receiveCallback(input: {
    connectionId: string;
    rawBody: string;
    headers: Headers;
  }): Promise<{ matched: boolean; correlation: string }> {
    const tenantId = await deps.locator.tenantOf(input.connectionId);

    if (!tenantId) throw notFound("CarrierConnection", input.connectionId);

    const ctx: TenantContext = {
      tenantId: asId(tenantId),
      actor: { type: "system", process: "carrier.callback" },
    };

    const { connection, expressions } = await deps.uow.run(ctx, async (tx) => {
      const found = await deps.carriers.findConnection(tx, ctx, input.connectionId);

      if (!found) throw notFound("CarrierConnection", input.connectionId);

      const versions = await deps.connectors.versions(tx, ctx, found.carrierId);

      return {
        connection: found,
        expressions: [
          ...new Set(
            versions
              .toSorted((a, b) => b.version - a.version)
              .map((v) => v.definition.callbacks.correlation),
          ),
        ],
      };
    });

    if (connection.callback.signature === "hmac_sha256") {
      const sealed = connection.secrets.callbackSecret;

      if (!sealed) throw forbidden("The connection has no callback secret");

      const secret = deps.secrets.open(sealed, secretContext(connection, "callbackSecret"));

      if (!verify(secret, input.rawBody, input.headers.get(connection.callback.header))) {
        throw forbidden("The callback signature doesn't match");
      }
    }

    let body: unknown;

    try {
      body = JSON.parse(input.rawBody);
    } catch {
      throw new DomainError("invalid", "Callbacks must be JSON");
    }

    const headers = Object.fromEntries(input.headers.entries());

    const correlation = expressions
      .map((expression) => {
        try {
          const value = evaluateMapping(expression, { body, headers });

          return typeof value === "string" || typeof value === "number" ? String(value) : "";
        } catch {
          return "";
        }
      })
      .find(Boolean);

    if (!correlation) throw new DomainError("invalid", "The callback carries no correlation key");

    const pending = await deps.uow.run(ctx, (tx) =>
      deps.callbacks.receive(tx, ctx, { connectionId: connection.id, correlation, payload: body }),
    );

    if (!pending.workflowRunId || !pending.event || pending.signalled)
      return { matched: false, correlation };

    await deps.workflows().signal(ctx, pending.workflowRunId, pending.event, { body });

    await deps.uow.run(ctx, (tx) =>
      deps.callbacks.markSignalled(tx, ctx, { connectionId: connection.id, correlation }),
    );

    return { matched: true, correlation };
  };
}
