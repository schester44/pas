import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export type { Prisma } from "./generated/prisma/client";
export { PrismaClient };

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalForPrisma = globalThis as unknown as { pasPrisma?: PrismaClient };

/** Process-wide client. Composition roots use this; nothing else should construct clients. */
export function getPrismaClient(): PrismaClient {
  if (!globalForPrisma.pasPrisma) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    globalForPrisma.pasPrisma = createPrismaClient(url);
  }
  return globalForPrisma.pasPrisma;
}
