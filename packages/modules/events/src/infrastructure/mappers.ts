import { instantFromDb, instantToDb } from "@pas/db";
import type { Instant } from "@pas/kernel";

export const maybeInstant = (date: Date | null): Instant | null =>
  date ? instantFromDb(date) : null;

export const maybeDate = (instant: Instant | null): Date | null =>
  instant ? instantToDb(instant) : null;

export const json = <T>(value: T) => value as never;
