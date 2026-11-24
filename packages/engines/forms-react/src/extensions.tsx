import { setAt } from "@pas/forms-core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { createContext, useContext, useEffect, useState } from "react";
import type { Copy } from "./copy";

type Values = Record<string, unknown>;
export type FieldOption = { value: string; label: string };

/**
 * What a product's field extensions add to a form (PLAN §15.1): options a server-side extension
 * supplies, and fields whose change asks an extension for values. Nothing runs in the browser.
 */
export interface FormExtensions {
  optionFields: readonly string[];
  prefillFields: readonly string[];
  loadOptions: (field: string, values: Values) => Promise<FieldOption[]>;
  /** `path` is where the trigger changed, with row ids, when it sits inside a repeat. */
  prefill: (field: string, values: Values, path: string) => Promise<Values>;
}

export const FormExtensionsContext = createContext<FormExtensions | null>(null);

export const useFormExtensions = () => useContext(FormExtensionsContext);

const OPTIONS_DEBOUNCE_MS = 300;

/** A select whose options come from the field's extension; they reload as the form changes. */
export function ExtensionOptions(props: {
  id: string;
  canonical: string;
  values: Values;
  value: unknown;
  onChange: (value: unknown) => void;
  invalid: boolean;
  describedBy?: string;
  placeholder?: string;
  copy: Copy;
}) {
  const extensions = useFormExtensions();
  const [options, setOptions] = useState<FieldOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const key = JSON.stringify(props.values);

  useEffect(() => {
    if (!extensions) return;

    let cancelled = false;

    const timer = setTimeout(() => {
      extensions
        .loadOptions(props.canonical, JSON.parse(key) as Values)
        .then((loaded) => {
          if (!cancelled) {
            setOptions(loaded);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    }, OPTIONS_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [extensions, props.canonical, key]);

  const current = typeof props.value === "string" ? props.value : "";
  const listed = options ?? [];

  const withCurrent =
    current && !listed.some((o) => o.value === current)
      ? [{ value: current, label: current }, ...listed]
      : listed;

  return (
    <Select value={current} onValueChange={props.onChange} disabled={options === null && !failed}>
      <SelectTrigger
        id={props.id}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
      >
        <SelectValue
          placeholder={
            failed
              ? props.copy.optionsUnavailable
              : options === null
                ? props.copy.loadingOptions
                : (props.placeholder ?? props.copy.choose)
          }
        />
      </SelectTrigger>
      <SelectContent>
        {withCurrent.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Where a prefilled path lands. A trigger inside a repeat row fills paths in the same row:
 * `vehicles[].model` from a trigger at `vehicles[#a1].vin` becomes `vehicles[#a1].model`.
 */
export function prefillTarget(target: string, triggerPath: string, triggerCanonical: string) {
  const repeat = triggerCanonical.lastIndexOf("[]");

  if (repeat === -1) return target.includes("[]") ? null : target;

  const prefix = triggerCanonical.slice(0, repeat + 2);

  if (!target.startsWith(prefix)) return target.includes("[]") ? null : target;

  const depth = prefix.split("[]").length - 1;
  let seen = 0;
  let end = -1;

  for (let i = 0; i < triggerPath.length; i++) {
    if (triggerPath[i] === "]" && ++seen === depth) {
      end = i + 1;
      break;
    }
  }

  return end === -1 ? null : triggerPath.slice(0, end) + target.slice(prefix.length);
}

export function applyPrefill(
  data: Values,
  filled: Values,
  triggerPath: string,
  triggerCanonical: string,
): Values {
  return Object.entries(filled).reduce((next, [target, value]) => {
    const path = prefillTarget(target, triggerPath, triggerCanonical);

    return path ? setAt(next, path, value) : next;
  }, data);
}
