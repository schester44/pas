import type { AddressValue, FieldNode, FileValue, FormItem } from "@pas/forms-core";
import { currencyDecimals } from "@pas/forms-core";
import { Checkbox } from "@pas/ui/components/checkbox";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@pas/ui/components/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Textarea } from "@pas/ui/components/textarea";
import { cn } from "@pas/ui/lib/utils";
import type * as React from "react";
import { AddressField } from "./address-field";
import type { Copy } from "./copy";

export interface ControlProps {
  id: string;
  field: FieldNode;
  item: FormItem;
  value: unknown;
  onChange: (value: unknown) => void;
  invalid: boolean;
  describedBy?: string;
  copy: Copy;
  uploadFile?: (file: File) => Promise<FileValue>;
}

const text = (value: unknown) =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";

const emptyToUndefined = (value: string) => (value === "" ? undefined : value);

// Keep what the user typed until it round-trips exactly, so "1.50" and "12." survive editing.
function parseTyped(raw: string): unknown {
  const trimmed = raw.trim();

  if (trimmed === "") return undefined;

  const number = Number(trimmed);

  return Number.isFinite(number) && String(number) === trimmed ? number : raw;
}

function aria(props: ControlProps) {
  return {
    id: props.id,
    "aria-invalid": props.invalid || undefined,
    "aria-describedby": props.describedBy,
  };
}

function Affixed({
  prefix,
  suffix,
  children,
}: {
  prefix?: string;
  suffix?: string;
  children: React.ReactElement;
}) {
  return (
    <div className="relative">
      {prefix && (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
          {prefix}
        </span>
      )}
      {children}
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}

function currencySymbol(currency = "USD"): string {
  const parts = new Intl.NumberFormat(undefined, { style: "currency", currency }).formatToParts(0);

  return parts.find((part) => part.type === "currency")?.value ?? currency;
}

function NumberControl(props: ControlProps) {
  const { field, item, value, onChange } = props;
  const decimal = field.kind !== "integer";

  const input = (
    <Input
      {...aria(props)}
      inputMode={decimal ? "decimal" : "numeric"}
      autoComplete="off"
      placeholder={item.placeholder}
      className={cn("tabular-nums", field.kind === "percent" && "pr-8")}
      value={text(value)}
      onChange={(event) => onChange(parseTyped(event.target.value))}
    />
  );

  return field.kind === "percent" ? <Affixed suffix="%">{input}</Affixed> : input;
}

function MoneyControl(props: ControlProps) {
  const { field, item, value, onChange } = props;
  const symbol = currencySymbol(field.currency);

  return (
    <Affixed prefix={symbol}>
      <Input
        {...aria(props)}
        inputMode={currencyDecimals(field.currency) > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        placeholder={item.placeholder}
        className="tabular-nums"
        style={{ paddingLeft: `calc(${symbol.length}ch + 1.25rem)` }}
        value={text(value)}
        onChange={(event) => onChange(emptyToUndefined(event.target.value))}
      />
    </Affixed>
  );
}

function OptionRadios(props: ControlProps & { options: { value: string; label: string }[] }) {
  const { id, options, value, onChange } = props;
  const current = typeof value === "boolean" ? String(value) : text(value);

  return (
    <RadioGroup
      {...aria(props)}
      value={current}
      onValueChange={onChange}
      className={cn(options.length <= 3 && "flex flex-wrap gap-x-6 gap-y-2.5")}
    >
      {options.map((option) => (
        <div key={option.value} className="flex items-center gap-2">
          <RadioGroupItem id={`${id}-${option.value}`} value={option.value} />
          <Label htmlFor={`${id}-${option.value}`} className="font-normal">
            {option.label}
          </Label>
        </div>
      ))}
    </RadioGroup>
  );
}

function BooleanControl(props: ControlProps) {
  const { id, item, value, onChange, copy } = props;

  if (item.widget === "checkbox") {
    return (
      <Checkbox
        {...aria(props)}
        id={id}
        checked={value === true}
        onCheckedChange={(checked) => onChange(checked === true)}
      />
    );
  }

  return (
    <OptionRadios
      {...props}
      options={[
        { value: "true", label: copy.yes },
        { value: "false", label: copy.no },
      ]}
      onChange={(next) => onChange(next === "true")}
    />
  );
}

function EnumControl(props: ControlProps) {
  const { field, item, value, onChange, copy } = props;
  const options = field.options ?? [];
  const radios = item.widget === "radio" || (item.widget !== "select" && options.length <= 3);

  if (radios) return <OptionRadios {...props} options={options} />;

  return (
    <Select value={text(value)} onValueChange={onChange}>
      <SelectTrigger {...aria(props)}>
        <SelectValue placeholder={item.placeholder ?? copy.choose} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MultiEnumControl(props: ControlProps) {
  const { id, field, value, onChange } = props;
  const selected = new Set(Array.isArray(value) ? value : []);

  const toggle = (option: string, on: boolean) => {
    const next = (field.options ?? [])
      .map((candidate) => candidate.value)
      .filter((candidate) => (candidate === option ? on : selected.has(candidate)));

    onChange(next.length > 0 ? next : undefined);
  };

  return (
    <div role="group" aria-describedby={props.describedBy} className="grid gap-2.5 sm:grid-cols-2">
      {field.options?.map((option) => (
        <div key={option.value} className="flex items-center gap-2">
          <Checkbox
            id={`${id}-${option.value}`}
            checked={selected.has(option.value)}
            aria-invalid={props.invalid || undefined}
            onCheckedChange={(checked) => toggle(option.value, checked === true)}
          />
          <Label htmlFor={`${id}-${option.value}`} className="font-normal">
            {option.label}
          </Label>
        </div>
      ))}
    </div>
  );
}

function AddressControl(props: ControlProps) {
  const { id, field, value, onChange, copy, invalid, describedBy } = props;

  return (
    <AddressField
      id={id}
      value={
        typeof value === "object" && value !== null ? (value as Partial<AddressValue>) : undefined
      }
      onChange={onChange}
      country={field.country}
      invalid={invalid}
      describedBy={describedBy}
      copy={copy.address}
    />
  );
}

function FileControl(props: ControlProps) {
  const { value, onChange, uploadFile } = props;
  const file = typeof value === "object" && value !== null ? (value as FileValue) : undefined;

  return (
    <div className="grid gap-1.5">
      <Input
        {...aria(props)}
        type="file"
        disabled={!uploadFile}
        className="file:mr-3 file:text-sm file:font-medium"
        onChange={async (event) => {
          const picked = event.target.files?.[0];

          if (picked && uploadFile) onChange(await uploadFile(picked));
        }}
      />
      {file && <p className="m-0 truncate text-xs text-muted-foreground">{file.name}</p>}
    </div>
  );
}

export function Control(props: ControlProps) {
  const { field, item, value, onChange } = props;

  switch (field.kind) {
    case "number":
    case "integer":
    case "percent":
      return <NumberControl {...props} />;
    case "money":
      return <MoneyControl {...props} />;
    case "boolean":
      return <BooleanControl {...props} />;
    case "enum":
      return <EnumControl {...props} />;
    case "multi_enum":
      return <MultiEnumControl {...props} />;
    case "address":
      return <AddressControl {...props} />;
    case "file":
      return <FileControl {...props} />;
    case "date":
      return (
        <Input
          {...aria(props)}
          type="date"
          className="tabular-nums"
          value={text(value)}
          onChange={(event) => onChange(emptyToUndefined(event.target.value))}
        />
      );
    case "text":
      if (item.widget === "textarea") {
        return (
          <Textarea
            {...aria(props)}
            placeholder={item.placeholder}
            value={text(value)}
            onChange={(event) => onChange(emptyToUndefined(event.target.value))}
          />
        );
      }

      return (
        <Input
          {...aria(props)}
          placeholder={item.placeholder}
          value={text(value)}
          onChange={(event) => onChange(emptyToUndefined(event.target.value))}
        />
      );
    case "phone":
    case "email":
      return (
        <Input
          {...aria(props)}
          type={field.kind === "phone" ? "tel" : "email"}
          autoComplete={field.kind === "phone" ? "tel" : "email"}
          placeholder={item.placeholder}
          value={text(value)}
          onChange={(event) => onChange(emptyToUndefined(event.target.value))}
        />
      );
  }
}

export const WIDE_KINDS = new Set<FieldNode["kind"]>(["address", "multi_enum", "file"]);
