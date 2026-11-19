import { Money, type PlainDate } from "@pas/kernel";

export interface OpenInstallment {
  id: string;
  status: "scheduled" | "open" | "past_due" | "partially_paid";
  dueOn: PlainDate;
  balance: Money;
  fee: Money;
}

export interface CreditAllocation {
  id: string;
  waivedFee: Money;
  credited: Money;
  settled: boolean;
}

export interface Netting {
  allocations: CreditAllocation[];
  refund: Money;
  owed: Money;
}

const min = (a: Money, b: Money) => (a.amount.lessThan(b.amount) ? a : b);

/**
 * Nets a credit against unpaid installments before anything is refunded (PLAN §13): the latest
 * installments first. On cancellation the fees of installments not yet billed are waived, since
 * those installments never come due. Only what's left of the credit is refunded.
 */
export function netCredit(
  credit: Money,
  installments: readonly OpenInstallment[],
  options: { waiveScheduledFees: boolean },
): Netting {
  const currency = credit.currency;
  let remaining = credit;

  const ordered = installments.toSorted((a, b) => Temporal.PlainDate.compare(b.dueOn, a.dueOn));

  const allocations = ordered.map((installment) => {
    const waivedFee =
      options.waiveScheduledFees && installment.status === "scheduled"
        ? min(installment.fee, installment.balance)
        : Money.zero(currency);

    const due = installment.balance.minus(waivedFee);

    const credited =
      remaining.isNegative() || remaining.isZero() ? Money.zero(currency) : min(remaining, due);

    remaining = remaining.minus(credited);

    return { id: installment.id, waivedFee, credited, settled: due.minus(credited).isZero() };
  });

  const owed = ordered.reduce(
    (sum, installment, i) =>
      sum.plus(
        installment.balance.minus(allocations[i]!.waivedFee).minus(allocations[i]!.credited),
      ),
    Money.zero(currency),
  );

  return {
    allocations: allocations.filter((a) => !a.waivedFee.isZero() || !a.credited.isZero()),
    refund: remaining,
    owed,
  };
}
