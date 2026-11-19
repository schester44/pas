import { builtInRoleOrder, roleLabel } from "@pas/auth/permissions";
import type { Endorsable, EndorsableRule } from "@pas/forms-core";
import { Checkbox } from "@pas/ui/components/checkbox";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { useId } from "react";
import { Code, Prop } from "./inspector";

type Mode = "never" | "always" | "conditional";

const modeOf = (value: Endorsable | undefined): Mode =>
  value === true ? "always" : typeof value === "object" ? "conditional" : "never";

const summary = (value: Endorsable | undefined) => {
  if (value === true) return "Always";

  if (typeof value !== "object") return "Never";

  const parts = [
    value.when && <Code key="when">{value.when}</Code>,
    value.roles?.length && `by ${value.roles.map(roleLabel).join(", ")}`,
  ].filter(Boolean);

  return parts.length > 0 ? <span className="grid gap-1">{parts}</span> : "Always";
};

/**
 * Whether a field, or a repeatable's entries, can change by endorsement: never, always, or when
 * a condition over the issued risk and the change holds, for some roles (PLAN §7.4).
 */
export function EndorsableProp({
  label,
  value,
  readOnly,
  inRow,
  onChange,
}: {
  label: string;
  value: Endorsable | undefined;
  readOnly?: boolean;
  /** Inside a repeatable, the condition can read the entry as `$item`. */
  inRow: boolean;
  onChange: (value: Endorsable | undefined) => void;
}) {
  const id = useId();
  const mode = modeOf(value);
  const rule: EndorsableRule = typeof value === "object" ? value : {};

  if (readOnly) return <Prop readOnly label={label} value={summary(value)} />;

  const patch = (changes: Partial<EndorsableRule>) => {
    const next = { ...rule, ...changes };

    onChange(
      Object.fromEntries(
        Object.entries(next).filter(
          ([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0),
        ),
      ),
    );
  };

  const toggleRole = (role: string, on: boolean) => {
    const roles = new Set(rule.roles ?? []);

    if (on) roles.add(role);
    else roles.delete(role);

    patch({ roles: builtInRoleOrder.filter((r) => roles.has(r)) });
  };

  return (
    <div className="grid gap-3">
      <Prop label={label} htmlFor={`${id}-mode`}>
        <Select
          value={mode}
          onValueChange={(next) =>
            onChange(next === "always" ? true : next === "conditional" ? {} : undefined)
          }
        >
          <SelectTrigger id={`${id}-mode`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="never">Never</SelectItem>
            <SelectItem value="always">Always</SelectItem>
            <SelectItem value="conditional">When a condition holds</SelectItem>
          </SelectContent>
        </Select>
      </Prop>
      {mode === "conditional" && (
        <div className="grid gap-3 pl-3">
          <Prop
            label="Condition"
            htmlFor={`${id}-when`}
            optional
            hint={
              <>
                Reads the issued risk,{" "}
                {inRow && (
                  <>
                    <Code>$item</Code> for the entry,{" "}
                  </>
                )}
                <Code>transaction.effectiveDate</Code>, <Code>term.effectiveDate</Code> and{" "}
                <Code>actor.role</Code>.
              </>
            }
          >
            <Input
              id={`${id}-when`}
              value={rule.when ?? ""}
              spellCheck={false}
              placeholder="date(transaction.effectiveDate) < date(term.effectiveDate) + duration('60d')"
              className="font-mono text-[0.8125rem]"
              onChange={(event) => patch({ when: event.target.value })}
            />
          </Prop>
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-2 text-sm font-medium">
              Roles <span className="font-normal text-muted-foreground">Optional</span>
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {builtInRoleOrder.map((role) => (
                <div key={role} className="flex items-center gap-2">
                  <Checkbox
                    id={`${id}-role-${role}`}
                    checked={rule.roles?.includes(role) ?? false}
                    onCheckedChange={(on) => toggleRole(role, on === true)}
                  />
                  <Label htmlFor={`${id}-role-${role}`} className="font-normal">
                    {roleLabel(role)}
                  </Label>
                </div>
              ))}
            </div>
          </fieldset>
          <Prop
            label="Reason when it can't change"
            htmlFor={`${id}-reason`}
            optional
            hint="Shown next to the field in the endorsement form."
          >
            <Input
              id={`${id}-reason`}
              value={rule.reason ?? ""}
              onChange={(event) => patch({ reason: event.target.value })}
            />
          </Prop>
        </div>
      )}
    </div>
  );
}
