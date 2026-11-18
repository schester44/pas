import { Money } from "@pas/kernel";
import type { RatingResult } from "./contract";

type MoneyJson = { amount: string; currency: string };

type Jsonified<T> = T extends Money
  ? MoneyJson
  : T extends (infer U)[]
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T;

export type RatingResultJson = Jsonified<RatingResult>;

const money = (json: MoneyJson) => Money.of(json.amount, json.currency);

export function ratingResultFromJson(json: RatingResultJson): RatingResult {
  return {
    ...json,
    coverages: json.coverages.map((c) => ({
      ...c,
      premium: money(c.premium),
      calculated: money(c.calculated),
    })),
    adjustments: json.adjustments.map((a) => ({
      ...a,
      minimum: money(a.minimum),
      adjustment: money(a.adjustment),
    })),
    total: money(json.total),
  };
}
