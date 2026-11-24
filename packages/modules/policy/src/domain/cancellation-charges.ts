import { invalid, Money } from "@pas/kernel";
import type { PremiumChange, RetainedLine } from "./proration";

export interface ExtensionCharge {
  code: string;
  description: string;
  amount: string;
}

const CENTS = /^\d{1,13}(\.\d{1,2})?$/;

/**
 * Adds an extension's cancellation charges as retained premium. Charges keep part of the return,
 * so together with minimum earned premium they can't exceed what's being returned.
 */
export function withCancellationCharges(
  returned: readonly PremiumChange[],
  retained: readonly RetainedLine[],
  charges: readonly ExtensionCharge[],
  currency: string,
): RetainedLine[] {
  const zero = Money.zero(currency);
  const refund = returned.reduce((sum, l) => sum.plus(l.amount), zero).negated();
  const kept = retained.reduce((sum, l) => sum.plus(l.amount), zero);

  const lines = charges.map((charge): RetainedLine => {
    if (!CENTS.test(charge.amount)) {
      throw invalid(
        `Cancellation charge ${charge.code}: ${charge.amount} isn't an amount in cents`,
      );
    }

    const amount = Money.of(charge.amount, currency);

    return { code: charge.code, name: charge.description, minimum: amount, amount };
  });

  const charged = lines.reduce((sum, l) => sum.plus(l.amount), zero);

  if (kept.plus(charged).amount.greaterThan(refund.amount)) {
    throw invalid(
      `Cancellation charges of ${charged.toString()} are more than the ${refund.minus(kept).toString()} left to return`,
      { reason: "charges_exceed_return" },
    );
  }

  return [...retained, ...lines.filter((l) => !l.amount.isZero())];
}
