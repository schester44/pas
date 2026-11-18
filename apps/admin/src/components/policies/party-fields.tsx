import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Plus, X } from "lucide-react";
import { useId } from "react";

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface Interest {
  kind: "mortgagee" | "additional_insured" | "loss_payee";
  name: string;
  address: Address | null;
  reference?: string;
}

const KINDS: { value: Interest["kind"]; label: string }[] = [
  { value: "mortgagee", label: "Mortgagee" },
  { value: "additional_insured", label: "Additional insured" },
  { value: "loss_payee", label: "Loss payee" },
];

const EMPTY: Address = { line1: "", city: "", region: "", postalCode: "", country: "US" };

export function AddressFields({
  value,
  onChange,
}: {
  value: Address | null;
  onChange: (value: Address) => void;
}) {
  const id = useId();
  const address = value ?? EMPTY;
  const set = (patch: Partial<Address>) => onChange({ ...address, ...patch });

  const field = (key: keyof Address, label: string, className = "") => (
    <div className={`grid gap-2 ${className}`}>
      <Label htmlFor={`${id}-${key}`}>{label}</Label>
      <Input
        id={`${id}-${key}`}
        value={address[key] ?? ""}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="grid gap-4 sm:grid-cols-6">
      {field("line1", "Street address", "sm:col-span-4")}
      {field("line2", "Apt, suite or unit", "sm:col-span-2")}
      {field("city", "City", "sm:col-span-3")}
      {field("region", "State", "sm:col-span-1")}
      {field("postalCode", "ZIP code", "sm:col-span-2")}
    </div>
  );
}

export function InterestsEditor({
  value,
  onChange,
}: {
  value: Interest[];
  onChange: (value: Interest[]) => void;
}) {
  const id = useId();

  const update = (index: number, patch: Partial<Interest>) =>
    onChange(value.map((interest, i) => (i === index ? { ...interest, ...patch } : interest)));

  return (
    <div className="grid gap-4">
      {value.length === 0 && (
        <p className="m-0 text-sm text-muted-foreground">None on this policy.</p>
      )}
      {value.map((interest, index) => (
        <div
          key={index}
          className="grid items-end gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_9rem_auto]"
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-kind-${index}`}>Type</Label>
            <Select
              value={interest.kind}
              onValueChange={(kind) => update(index, { kind: kind as Interest["kind"] })}
            >
              <SelectTrigger id={`${id}-kind-${index}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-name-${index}`}>Name</Label>
            <Input
              id={`${id}-name-${index}`}
              value={interest.name}
              onChange={(e) => update(index, { name: e.target.value })}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-ref-${index}`}>
              Loan number <span className="font-normal text-muted-foreground">Optional</span>
            </Label>
            <Input
              id={`${id}-ref-${index}`}
              value={interest.reference ?? ""}
              onChange={(e) => update(index, { reference: e.target.value })}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove interest"
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <X />
          </Button>
        </div>
      ))}
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...value, { kind: "mortgagee", name: "", address: null }])}
        >
          <Plus /> Add an interest
        </Button>
      </div>
    </div>
  );
}
