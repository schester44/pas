import { evaluate, type ExpressionContext, validate } from "@pas/expressions";

const PLACEHOLDER = /\{\{\s*([\s\S]+?)\s*\}\}/g;

export class MappingError extends Error {
  constructor(
    message: string,
    readonly expression: string,
  ) {
    super(message);
    this.name = "MappingError";
  }
}

/** Evaluates a ZEN mapping; errors name the expression so the flow editor can point at it. */
export function evaluateMapping(expression: string, context: ExpressionContext): unknown {
  try {
    return evaluate(expression, context);
  } catch (error) {
    throw new MappingError(error instanceof Error ? error.message : String(error), expression);
  }
}

export function evaluateCondition(expression: string, context: ExpressionContext): boolean {
  return evaluateMapping(expression, context) === true;
}

const stringify = (value: unknown): string =>
  value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

/** `"/applications/{{ steps.submit.output.id }}"` → `"/applications/A-1"`. */
export function renderTemplate(template: string, context: ExpressionContext): string {
  return template.replace(PLACEHOLDER, (_, expression: string) =>
    stringify(evaluateMapping(expression, context)),
  );
}

export function templateExpressions(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1]!);
}

export function checkExpression(expression: string): string | null {
  const result = validate(expression);

  return result.ok ? null : result.message;
}

export function checkTemplate(template: string): string | null {
  for (const expression of templateExpressions(template)) {
    const problem = checkExpression(expression);

    if (problem) return `{{ ${expression} }}: ${problem}`;
  }

  return null;
}
