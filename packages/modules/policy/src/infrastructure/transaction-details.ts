import { jsonToDb } from "@pas/db";
import type { Prisma } from "@pas/db/client";
import { Money } from "@pas/kernel";
import type { TransactionDetails } from "../domain/transaction";

type Json = Record<string, unknown>;
type MoneyJson = { amount: string; currency: string };

const money = (value: unknown) => Money.fromJSON(value as MoneyJson);

const withMoney = <T extends Json>(row: T, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, keys.includes(k) ? money(v) : v]));

export function detailsToJson(
  details: TransactionDetails | null,
): Prisma.InputJsonValue | undefined {
  return details ? jsonToDb(details) : undefined;
}

export function detailsFromJson(value: unknown): TransactionDetails | null {
  if (!value || typeof value !== "object") return null;

  const json = value as Json;
  const cancellation = json.cancellation as Json | undefined;
  const minimumEarned = cancellation?.minimumEarned as Json | null | undefined;

  return {
    ...(json as unknown as TransactionDetails),
    premium: ((json.premium ?? []) as Json[]).map((l) =>
      withMoney(l, ["before", "after", "amount"]),
    ),
    retained: ((json.retained ?? []) as Json[]).map((l) => withMoney(l, ["minimum", "amount"])),
    fees: ((json.fees ?? []) as Json[]).map((l) => withMoney(l, ["amount"])),
    annualBefore: money(json.annualBefore),
    annualAfter: money(json.annualAfter),
    ...(cancellation && {
      cancellation: {
        ...(cancellation as unknown as NonNullable<TransactionDetails["cancellation"]>),
        minimumEarned: minimumEarned
          ? {
              rule: minimumEarned.rule,
              minimum: money(minimumEarned.minimum),
              retained: money(minimumEarned.retained),
              lines: ((minimumEarned.lines ?? []) as Json[]).map((l) =>
                withMoney(l, ["minimum", "amount"]),
              ),
            }
          : null,
      },
    }),
  } as unknown as TransactionDetails;
}
