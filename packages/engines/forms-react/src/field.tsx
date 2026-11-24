import { ExtensionOptions, useFormExtensions } from "./extensions";
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
  /** Why the field can't change here; it shows its value without editing. */
  readOnly?: string | null;
  /** The schema path without row ids, for matching field extensions. */
  canonical: string;
  values: Record<string, unknown>;
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
  readOnly,
  canonical,
  values,
}: FieldProps) {
  const extensions = useFormExtensions();

  const extensionOptions =
    !!extensions?.optionFields.includes(canonical) &&
    (field.kind === "text" || field.kind === "enum");

  const id = domId(state.path);
  const errors = showErrors ? state.errors : [];
  const help = readOnly ?? (compact ? undefined : (item.help ?? field.description));

  const wide =
    item.width === "full" ||
    (item.width === undefined && (WIDE_KINDS.has(field.kind) || item.widget === "textarea"));

  const describedBy =
    [help && `${id}-help`, errors.length > 0 && `${id}-error`].filter(Boolean).join(" ") ||
    undefined;

  const grouped = field.kind === "address" || field.kind === "multi_enum";

  const control = (
    <fieldset disabled={!!readOnly} className="m-0 min-w-0 border-0 p-0">
      {extensionOptions ? (
        <ExtensionOptions
          id={id}
          canonical={canonical}
          values={values}
          value={value}
          onChange={onChange}
          invalid={errors.length > 0}
          describedBy={describedBy}
          {...(item.placeholder && { placeholder: item.placeholder })}
          copy={copy}
        />
      ) : (
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
      )}
    </fieldset>
  );

  const messages = (
    <>
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
    </>
  );

  // An unchecked box is itself an answer, so inline checkboxes never show "Optional".
  if (field.kind === "boolean" && item.widget === "checkbox") {
    return (
      <div className={cn("flex items-start gap-2.5", wide && "@xl:col-span-2")}>
        <div className="flex h-5 items-center">{control}</div>
        <div className="grid gap-1">
          <Label htmlFor={id} className="leading-5 font-normal">
            {item.label ?? field.label}
          </Label>
          {messages}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("@container grid content-start gap-2", wide && "@xl:col-span-2")}>
      <div className="flex items-baseline justify-between gap-3">
        {grouped ? (
          <span className="text-sm leading-none font-medium">{item.label ?? field.label}</span>
        ) : (
          <Label htmlFor={id}>{item.label ?? field.label}</Label>
        )}
        {!state.required && !readOnly && (
          <span className="text-xs leading-none text-muted-foreground">{copy.optional}</span>
        )}
      </div>
      {control}
      {messages}
    </div>
  );
}
