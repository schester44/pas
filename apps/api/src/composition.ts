// Composition root: the only place that knows which adapters implement which ports.
import { createAuth } from "@pas/auth";
import { makeCreateProduct, makeListProducts } from "@pas/catalog";
import { PrismaProductRepository } from "@pas/catalog/infrastructure";
import { getPrismaClient, PrismaUnitOfWork } from "@pas/db";
import { systemClock } from "@pas/kernel";
import { createLogger } from "@pas/observability";
import { PgBossOutbox, QueueClient } from "@pas/queues";
import { env } from "./env";

export function compose() {
  const logger = createLogger("api");
  const prisma = getPrismaClient();
  const queues = new QueueClient({ connectionString: env.DATABASE_URL }, logger);

  const uow = new PrismaUnitOfWork(prisma);
  const outbox = new PgBossOutbox(queues);
  const clock = systemClock;

  const auth = createAuth({
    prisma,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.ADMIN_ORIGIN, env.APP_ORIGIN],
  });

  const products = new PrismaProductRepository();

  return {
    logger,
    auth,
    prisma,
    queues,
    useCases: {
      catalog: {
        createProduct: makeCreateProduct({ uow, outbox, products, clock }),
        listProducts: makeListProducts({ uow, products }),
      },
    },
  };
}

export type Container = ReturnType<typeof compose>;
