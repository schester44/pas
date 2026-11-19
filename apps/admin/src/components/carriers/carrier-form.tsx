import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { Notice } from "@pas/ui/components/notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import { useState } from "react";
import { Field } from "@/components/distribution/agency-dialog";
import { slugify } from "@/lib/format";
import { MODES } from "./labels";

export interface CarrierValues {
  id?: string;
  key: string;
  name: string;
  naic: string | null;
  amBest: string | null;
  admitted: string[];
  lines: string[];
  mode: keyof typeof MODES;
  extensionKey: string | null;
  activeEnvironment: "test" | "live";
}

export const EMPTY_CARRIER: CarrierValues = {
  key: "",
  name: "",
  naic: null,
  amBest: null,
  admitted: [],
  lines: [],
  mode: "connector",
  extensionKey: null,
  activeEnvironment: "test",
};

const list = (text: string) =>
  text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/** Carrier profile: identity, ratings, where and what it writes, and how it's connected. */
export function CarrierForm({
  initial,
  submitLabel,
  busy,
  error,
  readOnly,
  onSubmit,
}: {
  initial: CarrierValues;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  readOnly?: boolean;
  onSubmit: (values: CarrierValues) => void;
}) {
  const [values, setValues] = useState(initial);
  const [admitted, setAdmitted] = useState(initial.admitted.join(", "));
  const [lines, setLines] = useState(initial.lines.join(", "));

  const set = <K extends keyof CarrierValues>(key: K, value: CarrierValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ ...values, admitted: list(admitted), lines: list(lines) });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" id="carrier-name">
          <Input
            id="carrier-name"
            value={values.name}
            readOnly={readOnly}
            onChange={(e) => {
              set("name", e.target.value);

              if (!initial.id) set("key", slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="Key" id="carrier-key">
          <Input
            id="carrier-key"
            value={values.key}
            readOnly={readOnly || !!initial.id}
            className="font-mono text-xs"
            onChange={(e) => set("key", e.target.value)}
          />
        </Field>
        <Field label="NAIC code" id="carrier-naic" optional>
          <Input
            id="carrier-naic"
            value={values.naic ?? ""}
            readOnly={readOnly}
            inputMode="numeric"
            className="tabular-nums"
            onChange={(e) => set("naic", e.target.value || null)}
          />
        </Field>
        <Field label="AM Best rating" id="carrier-best" optional>
          <Input
            id="carrier-best"
            value={values.amBest ?? ""}
            readOnly={readOnly}
            onChange={(e) => set("amBest", e.target.value || null)}
          />
        </Field>
        <Field label="Admitted in" id="carrier-admitted" optional>
          <Input
            id="carrier-admitted"
            value={admitted}
            readOnly={readOnly}
            placeholder="US-IL, US-IN"
            onChange={(e) => setAdmitted(e.target.value)}
          />
        </Field>
        <Field label="Lines of business" id="carrier-lines" optional>
          <Input
            id="carrier-lines"
            value={lines}
            readOnly={readOnly}
            placeholder="Homeowners"
            onChange={(e) => setLines(e.target.value)}
          />
        </Field>
        <Field label="Connected by" id="carrier-mode">
          <Select
            value={values.mode}
            onValueChange={(v) => set("mode", v as CarrierValues["mode"])}
            disabled={readOnly}
          >
            <SelectTrigger id="carrier-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MODES).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Production environment" id="carrier-env">
          <Select
            value={values.activeEnvironment}
            onValueChange={(v) => set("activeEnvironment", v as "test" | "live")}
            disabled={readOnly}
          >
            <SelectTrigger id="carrier-env">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="test">Test</SelectItem>
              <SelectItem value="live">Live</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {values.mode === "extension" && (
          <Field label="Extension key" id="carrier-extension">
            <Input
              id="carrier-extension"
              value={values.extensionKey ?? ""}
              readOnly={readOnly}
              className="font-mono text-xs"
              onChange={(e) => set("extensionKey", e.target.value || null)}
            />
          </Field>
        )}
      </div>
      {error && (
        <Notice tone="error" title="Couldn't save the carrier">
          {error}
        </Notice>
      )}
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !values.name.trim()}>
            {busy && <Spinner />}
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
