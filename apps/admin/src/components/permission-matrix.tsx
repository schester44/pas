import { resourceGroups, resourceLabels, statements } from "@pas/auth/permissions";
import { Checkbox } from "@pas/ui/components/checkbox";
import { cn } from "@pas/ui/lib/utils";
import { Check, Minus } from "lucide-react";
import { Fragment } from "react";

export type RoleStatements = Record<string, string[]>;

type Resource = keyof typeof statements;

export function countPermissions(value: RoleStatements): number {
  return Object.values(value).reduce((sum, actions) => sum + actions.length, 0);
}

export function PermissionMatrix({
  value,
  onChange,
}: {
  value: RoleStatements;
  onChange?: (value: RoleStatements) => void;
}) {
  return (
    <div>
      {resourceGroups.map((group) => (
        <Fragment key={group.label}>
          <div className="flex h-9 items-center border-y bg-muted/40 px-(--card-p) text-xs font-medium text-muted-foreground first:border-t-0">
            {group.label}
          </div>
          <ul className="m-0 list-none divide-y p-0">
            {group.resources.map((resource) => (
              <ResourceRow
                key={resource}
                resource={resource}
                granted={value[resource] ?? []}
                onChange={
                  onChange && ((actions) => onChange(withResource(value, resource, actions)))
                }
              />
            ))}
          </ul>
        </Fragment>
      ))}
    </div>
  );
}

function withResource(value: RoleStatements, resource: Resource, actions: string[]) {
  const next = { ...value };

  if (actions.length > 0) next[resource] = actions;
  else delete next[resource];

  return next;
}

function ResourceRow({
  resource,
  granted,
  onChange,
}: {
  resource: Resource;
  granted: string[];
  onChange?: (actions: string[]) => void;
}) {
  const label = resourceLabels[resource];
  const actions = viewFirst(statements[resource]);
  const all = granted.length === actions.length;

  function toggle(action: string, checked: boolean) {
    const next = new Set(granted);

    if (checked) next.add(action);
    else next.delete(action);

    onChange?.(actions.filter((a) => next.has(a)));
  }

  return (
    <li className="grid gap-3 px-(--card-p) py-3.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6">
      <div className="flex min-w-0 items-start gap-3">
        {onChange && (
          <Checkbox
            aria-label={`All ${label.label.toLowerCase()} permissions`}
            className="mt-0.5"
            checked={all ? true : granted.length > 0 ? "indeterminate" : false}
            onCheckedChange={() => onChange(all ? [] : [...actions])}
          />
        )}
        <div className="grid min-w-0 gap-0.5">
          <p className="m-0 text-sm leading-5 font-medium">{label.label}</p>
          <p className="m-0 text-sm text-muted-foreground">{label.description}</p>
        </div>
      </div>
      <div
        className={cn(
          "flex flex-wrap gap-x-5 gap-y-2 md:grid md:grid-cols-[repeat(4,6.5rem)] md:gap-x-2",
          onChange && "pl-7 md:pl-0",
        )}
      >
        {actions.map((action) => {
          const actionLabel = label.actions[action] ?? action;
          const checked = granted.includes(action);

          if (!onChange)
            return <GrantedAction key={action} label={actionLabel} granted={checked} />;

          const id = `perm-${resource}-${action}`;

          return (
            <label
              key={action}
              htmlFor={id}
              className="flex h-7 cursor-pointer items-center gap-2 text-sm select-none"
            >
              <Checkbox
                id={id}
                checked={checked}
                onCheckedChange={(next) => toggle(action, next === true)}
              />
              {actionLabel}
            </label>
          );
        })}
      </div>
    </li>
  );
}

function viewFirst(actions: readonly string[]): string[] {
  return actions.includes("read") ? ["read", ...actions.filter((a) => a !== "read")] : [...actions];
}

function GrantedAction({ label, granted }: { label: string; granted: boolean }) {
  return (
    <span
      className={cn(
        "flex h-7 items-center gap-2 text-sm",
        granted ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {granted ? (
        <Check aria-label="Allowed" className="size-4 text-primary" />
      ) : (
        <Minus aria-label="Not allowed" className="size-4 text-muted-foreground/60" />
      )}
      {label}
    </span>
  );
}
