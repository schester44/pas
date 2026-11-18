import { collectPaths, hasErrorNode, parseDebug, type PathOptions } from "./ast";
import { assertReady, zen } from "./runtime";

export { isReady, onReady, ready, ExpressionsNotReadyError } from "./runtime";
export type { PathOptions } from "./ast";

export type ExpressionContext = Record<string, unknown>;

export type ValidationResult = { ok: true } | { ok: false; message: string };

export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly expression: string,
  ) {
    super(message);
    this.name = "ExpressionError";
  }
}

function clean(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);

  return raw.replace(/^(VM|Parser|Lexer|Compiler) error: /, "");
}

function wrap<T>(expression: string, run: () => T): T {
  assertReady();

  try {
    return run();
  } catch (error) {
    throw new ExpressionError(clean(error), expression);
  }
}

type Segment = string | number;

const numberAt = (expression: string, path: Segment[]) =>
  `string((${expression})${path.map((segment) => `[${JSON.stringify(segment)}]`).join("")})`;

// zen-engine-wasm truncates decimals when handing values back to JS; string() keeps them exact.
function exactNumbers(
  value: unknown,
  read: (expression: string) => unknown,
  expression: string,
  path: Segment[] = [],
): unknown {
  if (typeof value === "number") return Number(read(numberAt(expression, path)));

  if (Array.isArray(value)) {
    return value.map((item, i) => exactNumbers(item, read, expression, [...path, i]));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        exactNumbers(item, read, expression, [...path, key]),
      ]),
    );
  }

  return value;
}

function exact(expression: string, read: (source: string) => unknown): unknown {
  return exactNumbers(read(expression), read, expression);
}

export function evaluate(expression: string, context: ExpressionContext = {}): unknown {
  return wrap(expression, () =>
    exact(expression, (source) => zen.evaluateExpression(source, context)),
  );
}

export function evaluateUnary(
  expression: string,
  context: ExpressionContext & { $: unknown },
): boolean {
  return wrap(expression, () => zen.evaluateUnaryExpression(expression, context));
}

function toResult(raw: unknown): ValidationResult {
  if (raw == null) return { ok: true };

  const source = (raw as { source?: unknown }).source;

  return { ok: false, message: typeof source === "string" ? source : "Invalid expression" };
}

export function validate(expression: string): ValidationResult {
  assertReady();

  if (!expression.trim()) return { ok: false, message: "Expression is empty" };

  return toResult(zen.validateExpression(expression));
}

export function validateUnary(expression: string): ValidationResult {
  assertReady();

  if (!expression.trim()) return { ok: false, message: "Expression is empty" };

  return toResult(zen.validateUnaryExpression(expression));
}

export function referencedPaths(
  expression: string,
  options: PathOptions & { unary?: boolean } = {},
): string[] {
  const check = options.unary ? validateUnary(expression) : validate(expression);

  if (!check.ok) throw new ExpressionError(check.message, expression);

  const source = options.unary ? zen.generateAstUnary(expression) : zen.generateAst(expression);
  let ast;

  try {
    ast = parseDebug(source);
  } catch (error) {
    throw new ExpressionError(clean(error), expression);
  }

  if (hasErrorNode(ast)) throw new ExpressionError("Expression doesn't parse", expression);

  const aliases = options.unary ? { $: null, ...options.aliases } : options.aliases;

  return collectPaths(ast, { aliases });
}

export interface ExpressionScope {
  evaluate(expression: string): unknown;
  evaluateUnary(expression: string): boolean;
  with(key: string, value: unknown): ExpressionScope;
  dispose(): void;
}

type ZenVariable = InstanceType<typeof zen.Variable>;

function scopeOf(variable: ZenVariable): ExpressionScope {
  return {
    evaluate: (expression) =>
      wrap(expression, () => exact(expression, (source) => variable.evaluateExpression(source))),
    evaluateUnary: (expression) =>
      wrap(expression, () => variable.evaluateUnaryExpression(expression)),
    with: (key, value) => {
      assertReady();

      return scopeOf(variable.cloneWith(key, value));
    },
    dispose: () => variable.free(),
  };
}

export function createScope(context: ExpressionContext): ExpressionScope {
  assertReady();

  return scopeOf(new zen.Variable(context));
}
