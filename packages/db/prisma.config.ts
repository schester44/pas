import { resolve } from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config({ path: resolve(import.meta.dirname, "../../.env"), quiet: true });

export default defineConfig({
  schema: "./src/prisma/schema",
  migrations: {
    path: "./src/prisma/migrations",
    seed: "tsx ./src/prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/pas",
  },
});
