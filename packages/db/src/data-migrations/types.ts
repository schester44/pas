import type { PrismaClient } from "../client";

export interface DataMigration {
  name: string;
  up: (ctx: { db: PrismaClient }) => Promise<void>;
}

export function migration(config: DataMigration): DataMigration {
  return config;
}
