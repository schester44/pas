import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { getPrismaClient } from "../client";
import type { DataMigration } from "./types";

/** Runs each data migration in ./migrations once, in filename order. */
async function main() {
  const db = getPrismaClient();
  const dir = resolve(import.meta.dirname, "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".ts")).toSorted();

  for (const file of files) {
    const mod = (await import(resolve(dir, file))) as { default: DataMigration };
    const { name, up } = mod.default;
    const done = await db.dataMigration.findUnique({ where: { name } });
    if (done) continue;

    console.log(`Running data migration ${name}`);
    await up({ db });
    await db.dataMigration.create({ data: { name } });
  }

  await db.$disconnect();
}

await main();
