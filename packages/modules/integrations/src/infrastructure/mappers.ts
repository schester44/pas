import type { Instant } from "@pas/kernel";

export const toInstant = (date: Date): Instant =>
  Temporal.Instant.fromEpochMilliseconds(date.getTime());

export const toDate = (instant: Instant): Date => new Date(instant.epochMilliseconds);

export const json = <T>(value: T) => value as never;
