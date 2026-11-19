import { evaluate, validate } from "@pas/expressions";
import { useExpressionsReady } from "@pas/forms-react";
import { Input } from "@pas/ui/components/input";
import { Textarea } from "@pas/ui/components/textarea";
import { cn } from "@pas/ui/lib/utils";
import { useMemo } from "react";
import { friendly } from "@/components/builders/expression-input";

const PLACEHOLDER = /\{\{\s*([\s\S]+?)\s*\}\}/g;

type Preview = { ok: true; value: string } | { ok: false; message: string } | null;

const show = (value: unknown) =>
  value === undefined || value === null
    ? "null"
    : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);

function previewExpression(expression: string, context: Record<string, unknown> | null): Preview {
  if (!expression.trim()) return null;

  const check = validate(expression);

  if (!check.ok) return { ok: false, message: friendly(check.message) };

  if (!context) return null;

  try {
    return { ok: true, value: show(evaluate(expression, context)) };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

function previewTemplate(template: string, context: Record<string, unknown> | null): Preview {
  const parts = [...template.matchAll(PLACEHOLDER)].map((m) => m[1]!);

  for (const part of parts) {
    const check = validate(part);

    if (!check.ok) return { ok: false, message: `{{ ${part} }}: ${friendly(check.message)}` };
  }

  if (!context || parts.length === 0) return null;

  try {
    return {
      ok: true,
      value: template.replace(PLACEHOLDER, (_, part: string) => {
        const value = evaluate(part, context);

        return value === null || value === undefined
          ? ""
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value);
      }),
    };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

/**
 * A ZEN mapping with a live preview against sample data: the canonical input, the steps of the
 * last test run, and for response mappings the step's own recorded response.
 */
export function MappingEditor({
  id,
  value,
  onChange,
  context,
  template,
  rows = 3,
  placeholder,
  readOnly,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  context: Record<string, unknown> | null;
  template?: boolean;
  rows?: number;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const ready = useExpressionsReady();

  const preview = useMemo(
    () =>
      ready
        ? template
          ? previewTemplate(value, context)
          : previewExpression(value, context)
        : null,
    [ready, template, value, context],
  );

  return (
    <div className="grid gap-1.5">
      {template ? (
        <Input
          id={id}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          className="font-mono text-xs"
        />
      ) : (
        <Textarea
          id={id}
          value={value}
          readOnly={readOnly}
          rows={rows}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          className="font-mono text-xs leading-5"
        />
      )}
      {preview && (
        <pre
          className={cn(
            "m-0 max-h-40 overflow-auto rounded-md px-2.5 py-1.5 font-mono text-[11px] leading-4 whitespace-pre-wrap",
            preview.ok ? "bg-muted/60 text-muted-foreground" : "bg-red-50 text-red-800",
          )}
        >
          {preview.ok ? preview.value : preview.message}
        </pre>
      )}
    </div>
  );
}
