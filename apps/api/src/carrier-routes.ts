import { DomainError } from "@pas/kernel";
import type { FastifyPluginAsync } from "fastify";
import type { Container } from "./composition";
import { toFetchHeaders } from "./http";

/**
 * Carrier callbacks (`POST /api/carriers/callbacks/:connectionId`, signature checked on the raw
 * body) and, outside production, the mock carrier under `/dev/mock-carrier/*`.
 */
export function carrierRoutes(container: Container): FastifyPluginAsync {
  return async (server) => {
    server.removeAllContentTypeParsers();

    server.addContentTypeParser(
      "*",
      { parseAs: "string", bodyLimit: 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );

    server.post<{ Params: { connectionId: string } }>(
      "/api/carriers/callbacks/:connectionId",
      async (req, reply) => {
        try {
          const result = await container.carriers.receiveCallback({
            connectionId: req.params.connectionId,
            rawBody: typeof req.body === "string" ? req.body : "",
            headers: toFetchHeaders(req),
          });

          return reply.send({ received: true, ...result });
        } catch (error) {
          if (error instanceof DomainError) {
            req.log.warn({ err: error, params: req.params }, "carrier callback rejected");

            const status =
              error.code === "not_found" ? 404 : error.code === "forbidden" ? 401 : 400;

            return reply.status(status).send({ message: error.message });
          }

          req.log.error({ err: error, params: req.params }, "carrier callback failed");

          return reply.status(500).send({ message: "Callback failed" });
        }
      },
    );

    const mock = container.mockCarrier;

    if (!mock) return;

    server.all("/dev/mock-carrier/*", async (req, reply) => {
      const raw = typeof req.body === "string" ? req.body : "";
      let body: unknown = null;

      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }

      const result = await mock.handle({
        method: req.method,
        path: (req.params as { "*": string })["*"].split("?")[0] ?? "",
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]),
        ),
        body,
      });

      reply.status(result.status);

      if (result.contentType) return reply.type(result.contentType).send(result.body);

      return reply.send(result.body);
    });
  };
}
