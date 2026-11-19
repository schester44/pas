import { Money } from "@pas/kernel";
import type { FeeLine, PremiumChange } from "./proration";
import type { TransactionDetails } from "./transaction";

export interface CarrierCharges {
  premium: { coverage: string; exposure?: string; amount: Money }[];
  fees: { code: string; label: string; amount: Money }[];
}

const keyOf = (line: { coverage: string; exposure?: string }) =>
  `${line.coverage}@${line.exposure ?? ""}`;

/**
 * "Carrier figures win" on a policy change (PLAN §12): the carrier's premium by coverage replaces
 * ours (coverages it omits move nothing), its fees replace same-code lines and add the rest.
 */
export function withCarrierCharges(
  details: TransactionDetails,
  charges: CarrierCharges,
): TransactionDetails {
  const theirs = new Map(charges.premium.map((line) => [keyOf(line), line]));
  const currency = details.annualAfter.currency;

  const premium: PremiumChange[] = details.premium.map((line) => {
    const amount = theirs.get(keyOf(line))?.amount ?? Money.zero(currency);

    return { ...line, amount, after: line.before.plus(amount) };
  });

  const known = new Set(details.premium.map(keyOf));

  for (const line of charges.premium) {
    if (known.has(keyOf(line))) continue;

    premium.push({
      coverage: line.coverage,
      ...(line.exposure !== undefined && { exposure: line.exposure }),
      name: line.coverage,
      before: Money.zero(currency),
      after: line.amount,
      amount: line.amount,
    });
  }

  const codes = new Set(charges.fees.map((fee) => fee.code));
  const kept = details.fees.filter((fee) => !codes.has(fee.code));

  const fees: FeeLine[] = [
    ...kept,
    ...charges.fees.map((fee) => ({
      code: fee.code,
      label: fee.label,
      remitter: "carrier",
      basis: "flat" as const,
      amount: fee.amount,
    })),
  ];

  const delta = premium.reduce((sum, line) => sum.plus(line.amount), Money.zero(currency));
  const ours = details.premium.reduce((sum, line) => sum.plus(line.amount), Money.zero(currency));

  return { ...details, premium, fees, annualAfter: details.annualAfter.plus(delta.minus(ours)) };
}
