import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import type * as React from "react";
import { useState } from "react";

const loaded = new Map<string, Promise<Stripe | null>>();

function stripeFor(publishableKey: string) {
  if (!loaded.has(publishableKey)) loaded.set(publishableKey, loadStripe(publishableKey));

  return loaded.get(publishableKey)!;
}

export function StripeProvider({
  publishableKey,
  children,
}: {
  publishableKey: string;
  children: React.ReactNode;
}) {
  return <Elements stripe={stripeFor(publishableKey)}>{children}</Elements>;
}

const elementStyle = {
  base: {
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif",
    fontSize: "14px",
    color: "#18181b",
    "::placeholder": { color: "#a1a1aa" },
  },
  invalid: { color: "#b91c1c" },
};

/** Card entry through Stripe Elements; the number never reaches our servers. */
export function useStripeCard() {
  const stripe = useStripe();
  const elements = useElements();
  const [name, setName] = useState("");
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fields = (
    <div className="grid gap-4 sm:grid-cols-6">
      <div className="grid gap-2 sm:col-span-6">
        <Label htmlFor="card-element">Card</Label>
        <div
          id="card-element"
          className="flex h-9 items-center rounded-md border border-input bg-background px-3 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
        >
          <CardElement
            className="w-full"
            options={{ style: elementStyle, hidePostalCode: false }}
            onChange={(event) => {
              setComplete(event.complete);
              setError(event.error?.message ?? null);
            }}
          />
        </div>
        {error && <p className="m-0 text-xs text-destructive">{error}</p>}
      </div>
      <div className="grid gap-2 sm:col-span-6">
        <Label htmlFor="card-name">Name on card</Label>
        <Input
          id="card-name"
          value={name}
          autoComplete="cc-name"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
    </div>
  );

  async function tokenize(): Promise<{ token: string } | { error: string }> {
    const card = elements?.getElement(CardElement);

    if (!stripe || !card) return { error: "The card form is still loading." };

    const result = await stripe.createPaymentMethod({
      type: "card",
      card,
      billing_details: { name: name.trim() },
    });

    return result.error
      ? { error: result.error.message ?? "Check the card details." }
      : { token: result.paymentMethod.id };
  }

  return { fields, ready: complete && name.trim().length > 0 && !!stripe, tokenize };
}
