import type { FieldNode, FileValue, FormItem, ItemState } from "@pas/forms-core";
import { Label } from "@pas/ui/components/label";
import { cn } from "@pas/ui/lib/utils";
import { Control, WIDE_KINDS } from "./controls";
import type { Copy } from "./copy";

interface FieldProps {
  field: FieldNode;
  item: FormItem;
  state: ItemState;
  value: unknown;
  onChange: (value: unknown) => void;
  showErrors: boolean;
  copy: Copy;
  uploadFile?: (file: File) => Promise<FileValue>;
  compact?: boolean;
}

const domId = (path: string) => `field-${path.replace(/[^A-Za-z0-9_-]/g, "-")}`;

export function Field({
  field,
  item,
  state,
  value,
  onChange,
  showErrors,
  copy,
  uploadFile,
  compact,
}: FieldProps) {
  const id = domId(state.path);
  const errors = showErrors ? state.errors : [];
  const help = compact ? undefined : (item.help ?? field.description);

  const wide =
    item.width === "full" ||
    (item.width === undefined && (WIDE_KINDS.has(field.kind) || item.widget === "textarea"));

  const describedBy =
    [help && `${id}-help`, errors.length > 0 && `${id}-error`].filter(Boolean).join(" ") ||
    undefined;

  const grouped = field.kind === "address" || field.kind === "multi_enum";

  return (
    <div className={cn("grid content-start gap-2", wide && "sm:col-span-2")}>
      <div className="flex items-baseline justify-between gap-3">
        {grouped ? (
          <span className="text-sm leading-none font-medium">{item.label ?? field.label}</span>
        ) : (
          <Label htmlFor={id}>{item.label ?? field.label}</Label>
        )}
        {!state.required && (
          <span className="text-xs leading-none text-muted-foreground">{copy.optional}</span>
        )}
      </div>
      <Control
        id={id}
        field={field}
        item={item}
        value={value}
        onChange={onChange}
        invalid={errors.length > 0}
        describedBy={describedBy}
        copy={copy}
        uploadFile={uploadFile}
      />
      {help && (
        <p id={`${id}-help`} className="m-0 text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {errors.length > 0 && (
        <p id={`${id}-error`} className="m-0 text-sm text-destructive">
          {errors[0]}
        </p>
      )}
    </div>
  );
}
