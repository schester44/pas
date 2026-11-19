import type { Prisma } from "@pas/db/client";

export const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
export const toInstant = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());
export const dateToDb = (d: Temporal.PlainDate) => new Date(`${d.toString()}T00:00:00Z`);
export const dateFromDb = (d: Date) => Temporal.PlainDate.from(d.toISOString().slice(0, 10));
export const optionalDate = (d: Date | null) => (d ? dateFromDb(d) : null);
export const decimal = (d: Prisma.Decimal) => d.toString();
