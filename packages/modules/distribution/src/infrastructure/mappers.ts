import { plainDateFromDb } from "@pas/db";
import type { Prisma } from "@pas/db/client";

export const optionalDate = (d: Date | null) => (d ? plainDateFromDb(d) : null);
export const decimal = (d: Prisma.Decimal) => d.toString();
