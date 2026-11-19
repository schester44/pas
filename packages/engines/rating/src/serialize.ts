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

export function ratingResultFromJson(json: RatingResultJson): RatingResult {
  return {
    ...json,
    coverages: json.coverages.map((c) => ({
      ...c,
      premium: Money.fromJSON(c.premium),
      calculated: Money.fromJSON(c.calculated),
    })),
    adjustments: json.adjustments.map((a) => ({
      ...a,
      minimum: Money.fromJSON(a.minimum),
      adjustment: Money.fromJSON(a.adjustment),
    })),
    total: Money.fromJSON(json.total),
  };
}
