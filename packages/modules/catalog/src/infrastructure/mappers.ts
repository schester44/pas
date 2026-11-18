export const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
export const toInstant = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());

export const plainDateToDb = (d: Temporal.PlainDate) => new Date(`${d.toString()}T00:00:00Z`);
export const plainDateFromDb = (d: Date) => Temporal.PlainDate.from(d.toISOString().slice(0, 10));
