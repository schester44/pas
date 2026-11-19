import { Decimal } from "decimal.js";

export type CurrencyCode = string;

export type RoundingMode = "half_up" | "half_even" | "up" | "down";

const ROUNDING: Record<RoundingMode, Decimal.Rounding> = {
  half_up: Decimal.ROUND_HALF_UP,
  half_even: Decimal.ROUND_HALF_EVEN,
  up: Decimal.ROUND_UP,
  down: Decimal.ROUND_DOWN,
};

/**
 * Immutable decimal money. Never use JS numbers for premium, taxes or fees.
 * Arithmetic keeps full precision; rounding is always explicit.
 */
export class Money {
  private constructor(
    readonly amount: Decimal,
    readonly currency: CurrencyCode,
  ) {}

  static of(amount: Decimal.Value, currency: CurrencyCode = "USD"): Money {
    return new Money(new Decimal(amount), currency);
  }

  static fromJSON(json: { readonly amount: string; readonly currency: CurrencyCode }): Money {
    return Money.of(json.amount, json.currency);
  }

  static zero(currency: CurrencyCode = "USD"): Money {
    return new Money(new Decimal(0), currency);
  }

  plus(other: Money): Money {
    this.assertSameCurrency(other);

    return new Money(this.amount.plus(other.amount), this.currency);
  }

  minus(other: Money): Money {
    this.assertSameCurrency(other);

    return new Money(this.amount.minus(other.amount), this.currency);
  }

  times(factor: Decimal.Value): Money {
    return new Money(this.amount.times(factor), this.currency);
  }

  dividedBy(divisor: Decimal.Value): Money {
    return new Money(this.amount.dividedBy(divisor), this.currency);
  }

  negated(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  round(decimalPlaces = 2, mode: RoundingMode = "half_up"): Money {
    return new Money(this.amount.toDecimalPlaces(decimalPlaces, ROUNDING[mode]), this.currency);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }

  /** String form for persistence (numeric columns) and JSON. */
  toString(): string {
    return this.amount.toFixed();
  }

  toJSON(): { amount: string; currency: CurrencyCode } {
    return { amount: this.toString(), currency: this.currency };
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}
