// Seed data for local development. Keep it small; tenants and users are created through the app.
import { getPrismaClient } from "../client";
import { seedDistribution } from "./seed/distribution";

const db = getPrismaClient();

await seedDistribution(db);
await db.$disconnect();
