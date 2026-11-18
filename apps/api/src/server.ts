import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";
import type { Container } from "./composition";
import { env } from "./env";
import { toFetchHeaders } from "./http";
import { adminRouter } from "./trpc/admin";
import { appRouter } from "./trpc/app";
import { createContext } from "./trpc/context";
import { platformRouter } from "./trpc/platform";
import { uploadRoutes } from "./uploads";
import { webhookRoutes } from "./webhooks";

export async function buildServer(container: Container) {
  const server = Fastify({
    loggerInstance: container.logger,
    bodyLimit: 8 * 1024 * 1024,
    routerOptions: { maxParamLength: 5000 },
  });

  await server.register(cors, {
    origin: [env.ADMIN_ORIGIN, env.APP_ORIGIN],
    credentials: true,
  });

  server.get("/health", async () => ({ ok: true }));

  await server.register(uploadRoutes(container));
  await server.register(webhookRoutes(container));

  // Better Auth handles everything under /api/auth.
  server.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(req, reply) {
      const url = new URL(req.url, `http://${req.headers.host}`);

      const response = await container.auth.handler(
        new Request(url, {
          method: req.method,
          headers: toFetchHeaders(req),
          ...(req.body ? { body: JSON.stringify(req.body) } : {}),
        }),
      );

      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));

      return reply.send(response.body ? await response.text() : null);
    },
  });

  await server.register(fastifyTRPCPlugin, {
    prefix: "/trpc/admin",
    trpcOptions: {
      router: adminRouter,
      createContext: ({ req }: { req: Parameters<typeof createContext>[1] }) =>
        createContext(container, req),
    },
  });

  await server.register(fastifyTRPCPlugin, {
    prefix: "/trpc/app",
    trpcOptions: {
      router: appRouter,
      createContext: ({ req }: { req: Parameters<typeof createContext>[1] }) =>
        createContext(container, req),
    },
  });

  await server.register(fastifyTRPCPlugin, {
    prefix: "/trpc/platform",
    trpcOptions: {
      router: platformRouter,
      createContext: ({ req }: { req: Parameters<typeof createContext>[1] }) =>
        createContext(container, req),
    },
  });

  return server;
}
