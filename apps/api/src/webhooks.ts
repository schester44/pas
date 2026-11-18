import { DomainError } from "@pas/kernel";
import type { FastifyPluginAsync } from "fastify";
import type { Container } from "./composition";
import { toFetchHeaders } from "./http";

/** Provider webhooks (`/api/webhooks/:kind/:installId`). Signatures are checked on the raw body. */
export function webhookRoutes(container: Container): FastifyPluginAsync {
  return async (server) => {
    server.removeAllContentTypeParsers();

    server.addContentTypeParser(
      "*",
      { parseAs: "string", bodyLimit: 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );

    server.post<{ Params: { kind: string; installId: string } }>(
      "/api/webhooks/:kind/:installId",
      async (req, reply) => {
        try {
          const result = await container.integrations.handleWebhook({
            kind: req.params.kind,
            installId: req.params.installId,
            rawBody: typeof req.body === "string" ? req.body : "",
            headers: toFetchHeaders(req),
          });

          return reply.send(result);
        } catch (error) {
          if (error instanceof DomainError && error.code === "not_found") {
            return reply.status(404).send({ message: "Unknown webhook" });
          }

          if (error instanceof DomainError && error.code === "forbidden") {
            req.log.warn({ err: error, params: req.params }, "webhook rejected");

            return reply.status(400).send({ message: error.message });
          }

          req.log.error({ err: error, params: req.params }, "webhook failed");

          return reply.status(500).send({ message: "Webhook failed" });
        }
      },
    );
  };
}
