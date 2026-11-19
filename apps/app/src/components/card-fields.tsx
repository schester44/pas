import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { cn } from "@pas/ui/lib/utils";

export interface CardDraft {
  number: string;
  expiry: string;
  cvc: string;
  name: string;
  postalCode: string;
}

export const EMPTY_CARD: CardDraft = { number: "", expiry: "", cvc: "", name: "", postalCode: "" };

const digits = (value: string) => value.replace(/\D/g, "");

const groupCard = (value: string) =>
  digits(value)
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, "$1 ");

function formatExpiry(value: string) {
  const d = digits(value).slice(0, 4);

  return d.length > 2 ? `${d.slice(0, 2)} / ${d.slice(2)}` : d;
}

const expiryParts = (card: CardDraft) => {
  const d = digits(card.expiry);

  return [d.slice(0, 2), d.slice(2, 4)] as const;
};

export function cardReady(card: CardDraft): boolean {
  const [month, year] = expiryParts(card);

  return (
    digits(card.number).length >= 13 &&
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    year.length === 2 &&
    /^\d{3,4}$/.test(card.cvc) &&
    card.name.trim().length > 0
  );
}

export function cardInput(card: CardDraft) {
  const [month, year] = expiryParts(card);

  return {
    number: digits(card.number),
    expMonth: Number(month),
    expYear: 2000 + Number(year),
    cvc: card.cvc,
    name: card.name.trim(),
    ...(card.postalCode.trim() && { postalCode: card.postalCode.trim() }),
  };
}

/** Card number, expiry, code, name and ZIP; six columns from `sm` unless `compact`. */
export function CardFields({
  card,
  onChange,
  compact,
}: {
  card: CardDraft;
  onChange: (card: CardDraft) => void;
  compact?: boolean;
}) {
  const set = (patch: Partial<CardDraft>) => onChange({ ...card, ...patch });
  const span = (wide: string) => (compact ? "" : wide);

  return (
    <div className={cn("grid gap-4", compact ? "grid-cols-2" : "sm:grid-cols-6")}>
      <div className={cn("grid gap-2", compact ? "col-span-2" : "sm:col-span-6")}>
        <Label htmlFor="card-number">Card number</Label>
        <Input
          id="card-number"
          value={card.number}
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="1234 1234 1234 1234"
          className="tabular-nums"
          onChange={(e) => set({ number: groupCard(e.target.value) })}
        />
      </div>
      <div className={cn("grid gap-2", span("sm:col-span-3"))}>
        <Label htmlFor="card-expiry">Expiry</Label>
        <Input
          id="card-expiry"
          value={card.expiry}
          inputMode="numeric"
          autoComplete="cc-exp"
          placeholder="MM / YY"
          className="tabular-nums"
          onChange={(e) => set({ expiry: formatExpiry(e.target.value) })}
        />
      </div>
      <div className={cn("grid gap-2", span("sm:col-span-3"))}>
        <Label htmlFor="card-cvc">Security code</Label>
        <Input
          id="card-cvc"
          value={card.cvc}
          inputMode="numeric"
          autoComplete="cc-csc"
          placeholder="CVC"
          className="tabular-nums"
          onChange={(e) => set({ cvc: digits(e.target.value).slice(0, 4) })}
        />
      </div>
      <div className={cn("grid gap-2", compact ? "col-span-2" : "sm:col-span-4")}>
        <Label htmlFor="card-name">Name on card</Label>
        <Input
          id="card-name"
          value={card.name}
          autoComplete="cc-name"
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>
      <div className={cn("grid gap-2", compact ? "col-span-2" : "sm:col-span-2")}>
        <Label htmlFor="card-zip">
          ZIP code <span className="font-normal text-muted-foreground">optional</span>
        </Label>
        <Input
          id="card-zip"
          value={card.postalCode}
          inputMode="numeric"
          autoComplete="postal-code"
          className="tabular-nums"
          onChange={(e) => set({ postalCode: e.target.value })}
        />
      </div>
    </div>
  );
}

export function TestCardHint() {
  return (
    <p className="m-0 text-xs text-muted-foreground tabular-nums">
      Test mode. 4242 4242 4242 4242 pays; 4000 0000 0000 0002 is declined; 4000 0000 0000 0341 pays
      now but its autopay charges decline.
    </p>
  );
}
