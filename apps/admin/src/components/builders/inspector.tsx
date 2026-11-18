import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import { Label } from "@pas/ui/components/label";
import { cn } from "@pas/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { createContext, use, useId } from "react";

export function InspectorHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b px-6 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
        )}
        <div className="grid min-w-0 gap-0.5">
          <h2 className="m-0 truncate text-base leading-6 font-semibold">{title}</h2>
          {subtitle && (
            <div className="truncate text-xs leading-5 text-muted-foreground">{subtitle}</div>
          )}
        </div>
      </div>
      {actions && <div className="-my-0.5 flex shrink-0 items-center gap-0.5">{actions}</div>}
    </header>
  );
}

export function InspectorBody({ children }: { children: React.ReactNode }) {
  return <div className="grid max-w-2xl gap-8 px-6 py-6">{children}</div>;
}

export function InspectorSection({
  title,
  readOnly,
  action,
  children,
}: {
  title?: string;
  readOnly?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3">
      {(title || action) && (
        <div className="flex h-6 items-center justify-between gap-4">
          {title && <h3 className="m-0 text-sm leading-5 font-semibold">{title}</h3>}
          {action}
        </div>
      )}
      {readOnly ? (
        <ReadOnlySection value={true}>
          <dl className="m-0 grid divide-y rounded-lg border px-4">{children}</dl>
        </ReadOnlySection>
      ) : (
        <div className="grid gap-4">{children}</div>
      )}
    </section>
  );
}

const ReadOnlySection = createContext(false);

export function PropRow({ children }: { children: React.ReactNode }) {
  if (use(ReadOnlySection)) return children;

  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function Prop({
  label,
  htmlFor,
  optional,
  hint,
  error,
  readOnly,
  value,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  optional?: boolean;
  hint?: React.ReactNode;
  error?: string;
  readOnly?: boolean;
  value?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  if (readOnly) {
    return (
      <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-4 py-2.5 text-sm">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="m-0 min-w-0 break-words">
          {value === undefined || value === "" ? <Empty /> : value}
        </dd>
      </div>
    );
  }

  return (
    <div className={cn("grid content-start gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {optional && <span className="text-xs leading-none text-muted-foreground">Optional</span>}
      </div>
      {children}
      {error ? (
        <p className="m-0 text-sm text-destructive">{error}</p>
      ) : (
        hint && <div className="m-0 text-xs leading-5 text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

export function FlagProp({
  label,
  description,
  checked,
  onChange,
  readOnly,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  readOnly?: boolean;
}) {
  const id = useId();

  if (readOnly) return <Prop readOnly label={label} value={checked ? "Yes" : "No"} />;

  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <div className="grid gap-1">
        <Label htmlFor={id}>{label}</Label>
        <p className="m-0 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function IconAction({
  label,
  icon: Icon,
  onClick,
  disabled,
  className,
}: {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn("size-8 text-muted-foreground hover:text-foreground", className)}
    >
      <Icon />
    </Button>
  );
}

export function Code({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <code className={cn("font-mono text-[0.8125rem] text-foreground", className)}>{children}</code>
  );
}

export function Empty() {
  return <span className="text-muted-foreground">–</span>;
}

export function PaneHeader({
  title,
  children,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3 pl-4">
      <span className="text-sm font-medium">{title}</span>
      {children}
    </div>
  );
}
