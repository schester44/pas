import { Money, type Instant, type PlainDate } from "@pas/kernel";
import type { Prisma } from "./generated/prisma/client";

export const instantFromDb = (date: Date): Instant =>
  Temporal.Instant.fromEpochMilliseconds(date.getTime());

export const instantToDb = (instant: Instant): Date => new Date(instant.epochMilliseconds);

// Postgres `date` columns arrive as UTC midnight; read the calendar date back in UTC.
export const plainDateFromDb = (date: Date): PlainDate =>
  Temporal.PlainDate.from(date.toISOString().slice(0, 10));

export const plainDateToDb = (date: PlainDate): Date => new Date(`${date.toString()}T00:00:00Z`);

export const moneyFromDb = (amount: Prisma.Decimal | string, currency: string): Money =>
  Money.of(amount.toString(), currency);

export const jsonToDb = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
