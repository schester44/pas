import { z } from "zod";

export const WIDGETS = ["textarea", "select", "radio", "checkbox", "checkboxes"] as const;
export type Widget = (typeof WIDGETS)[number];

export interface FormValidation {
  expression: string;
  message: string;
}

export interface FormItem {
  path: string;
  label?: string;
  help?: string;
  placeholder?: string;
  widget?: Widget;
  width?: "full" | "half";
  required?: boolean;
  visibleWhen?: string;
  requiredWhen?: string;
  validations?: FormValidation[];
}

export interface FormSection {
  id: string;
  title?: string;
  description?: string;
  visibleWhen?: string;
  repeat?: string;
  itemLabel?: string;
  items: FormItem[];
}

export interface FormStep {
  id: string;
  title: string;
  description?: string;
  visibleWhen?: string;
  sections: FormSection[];
}

export interface FormDefinition {
  key: string;
  title: string;
  steps: FormStep[];
}

const id = z.string().regex(/^[a-z][a-z0-9_-]*$/, "Use lowercase letters, digits, - and _");
const expression = z.string().min(1);

const formItemSchema = z.object({
  path: z.string().min(1),
  label: z.string().min(1).optional(),
  help: z.string().optional(),
  placeholder: z.string().optional(),
  widget: z.enum(WIDGETS).optional(),
  width: z.enum(["full", "half"]).optional(),
  required: z.boolean().optional(),
  visibleWhen: expression.optional(),
  requiredWhen: expression.optional(),
  validations: z.array(z.object({ expression, message: z.string().min(1) })).optional(),
});

const formSectionSchema = z.object({
  id,
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  visibleWhen: expression.optional(),
  repeat: z.string().min(1).optional(),
  itemLabel: z.string().min(1).optional(),
  items: z.array(formItemSchema),
});

export const formDefinitionSchema: z.ZodType<FormDefinition> = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  steps: z.array(
    z.object({
      id,
      title: z.string().min(1),
      description: z.string().optional(),
      visibleWhen: expression.optional(),
      sections: z.array(formSectionSchema),
    }),
  ),
});
