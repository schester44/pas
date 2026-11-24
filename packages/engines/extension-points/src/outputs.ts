import { isRecord } from "@pas/kernel";
import { type DisplayBlock, parseBlocks } from "./blocks";
import type { ExtensionPoint } from "./points";

export type Parsed<T> = { ok: true; value: T } | { ok: false; issues: string[] };

const DECIMAL = /^-?\d{1,15}(\.\d{1,6})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 500;

class Issues {
  readonly list: string[] = [];

  add(message: string) {
    if (this.list.length < 20) this.list.push(message);
  }

  result<T>(value: T): Parsed<T> {
    return this.list.length > 0 ? { ok: false, issues: this.list } : { ok: true, value };
  }
}

const text = (issues: Issues, value: unknown, at: string, max = 2_000): string => {
  if (typeof value !== "string" || value.length === 0) issues.add(`${at} must be text`);
  else if (value.length > max) issues.add(`${at} is longer than ${max} characters`);

  return typeof value === "string" ? value.slice(0, max) : "";
};

const optionalText = (issues: Issues, value: unknown, at: string, max = 2_000) =>
  value === undefined || value === null ? undefined : text(issues, value, at, max);

/** Money crosses the sandbox as decimal strings (numbers are accepted and converted). */
const decimal = (issues: Issues, value: unknown, at: string): string => {
  const raw = typeof value === "number" && Number.isFinite(value) ? String(value) : value;

  if (typeof raw !== "string" || !DECIMAL.test(raw)) {
    issues.add(`${at} must be a decimal amount like "125.00"`);

    return "0";
  }

  return raw;
};

const list = (issues: Issues, value: unknown, at: string): unknown[] => {
  if (!Array.isArray(value)) {
    issues.add(`${at} must be a list`);

    return [];
  }

  if (value.length > MAX_ITEMS) issues.add(`${at} has more than ${MAX_ITEMS} entries`);

  return value.slice(0, MAX_ITEMS);
};

const object = (issues: Issues, value: unknown, at: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    issues.add(`${at} must be an object`);

    return {};
  }

  return value;
};

export interface ValidationIssue {
  path?: string;
  message: string;
  severity: "error" | "warning";
}

export interface UnderwritingOutcome {
  outcome: "accept" | "refer" | "decline";
  reasonCode: string;
  message: string;
  authority?: string;
}

export interface ExtensionCoveragePremium {
  coverage: string;
  exposure?: string;
  premium: string;
}

export interface ExtensionRating {
  coverages: ExtensionCoveragePremium[];
  factors: { name: string; value: string; coverage?: string }[];
  warnings: { code: string; message: string }[];
}

export interface ExtensionInstallment {
  dueDate: string;
  amount: string;
}

export interface ExtensionCharge {
  code: string;
  description: string;
  amount: string;
}

export interface ActionResult {
  message?: string;
  blocks: DisplayBlock[];
  changeset?: { kind: "risk_patch"; values: Record<string, unknown> };
}

export interface PointOutputs {
  precommit: { risk: Record<string, unknown> };
  validate: { issues: ValidationIssue[] };
  rate: ExtensionRating;
  underwrite: { outcomes: UnderwritingOutcome[] };
  document_select: { add: string[]; remove: string[] };
  document_data: { data: Record<string, unknown> };
  installments: { installments: ExtensionInstallment[] };
  cancellation_charges: { charges: ExtensionCharge[] };
  field_options: { options: { value: string; label: string }[] };
  field_prefill: { values: Record<string, unknown> };
  record_panel: { blocks: DisplayBlock[] };
  action: ActionResult;
  automation: { done: true };
}

type Parser<P extends ExtensionPoint> = (output: unknown) => Parsed<PointOutputs[P]>;

const parsers: { [P in ExtensionPoint]: Parser<P> } = {
  precommit(output) {
    const issues = new Issues();
    const risk = object(issues, object(issues, output, "The output").risk, "risk");

    return issues.result({ risk });
  },

  validate(output) {
    const issues = new Issues();

    const found = list(issues, object(issues, output, "The output").issues, "issues").map(
      (raw, i): ValidationIssue => {
        const item = object(issues, raw, `issues[${i}]`);
        const severity = item.severity ?? "error";

        if (severity !== "error" && severity !== "warning") {
          issues.add(`issues[${i}].severity must be error or warning`);
        }

        const path = optionalText(issues, item.path, `issues[${i}].path`, 300);

        return {
          ...(path !== undefined && { path }),
          message: text(issues, item.message, `issues[${i}].message`, 500),
          severity: severity === "warning" ? "warning" : "error",
        };
      },
    );

    return issues.result({ issues: found });
  },

  rate(output) {
    const issues = new Issues();
    const root = object(issues, output, "The output");

    const coverages = list(issues, root.coverages, "coverages").map((raw, i) => {
      const item = object(issues, raw, `coverages[${i}]`);
      const exposure = optionalText(issues, item.exposure, `coverages[${i}].exposure`, 200);

      return {
        coverage: text(issues, item.coverage, `coverages[${i}].coverage`, 100),
        ...(exposure !== undefined && { exposure }),
        premium: decimal(issues, item.premium, `coverages[${i}].premium`),
      };
    });

    if (root.coverages !== undefined && coverages.length === 0) {
      issues.add("coverages must price at least one coverage");
    }

    const factors = (root.factors === undefined ? [] : list(issues, root.factors, "factors")).map(
      (raw, i) => {
        const item = object(issues, raw, `factors[${i}]`);
        const coverage = optionalText(issues, item.coverage, `factors[${i}].coverage`, 100);

        return {
          name: text(issues, item.name, `factors[${i}].name`, 200),
          value: String(item.value ?? ""),
          ...(coverage !== undefined && { coverage }),
        };
      },
    );

    const warnings = (
      root.warnings === undefined ? [] : list(issues, root.warnings, "warnings")
    ).map((raw, i) => {
      const item = object(issues, raw, `warnings[${i}]`);

      return {
        code: text(issues, item.code, `warnings[${i}].code`, 100),
        message: text(issues, item.message, `warnings[${i}].message`, 500),
      };
    });

    return issues.result({ coverages, factors, warnings });
  },

  underwrite(output) {
    const issues = new Issues();

    const outcomes = list(issues, object(issues, output, "The output").outcomes, "outcomes").map(
      (raw, i): UnderwritingOutcome => {
        const item = object(issues, raw, `outcomes[${i}]`);
        const outcome = item.outcome;

        if (outcome !== "accept" && outcome !== "refer" && outcome !== "decline") {
          issues.add(`outcomes[${i}].outcome must be accept, refer or decline`);
        }

        const authority = optionalText(issues, item.authority, `outcomes[${i}].authority`, 100);

        return {
          outcome: outcome === "refer" || outcome === "decline" ? outcome : "accept",
          reasonCode: text(issues, item.reasonCode, `outcomes[${i}].reasonCode`, 100),
          message: text(issues, item.message, `outcomes[${i}].message`, 500),
          ...(authority !== undefined && { authority }),
        };
      },
    );

    return issues.result({ outcomes });
  },

  document_select(output) {
    const issues = new Issues();
    const root = object(issues, output, "The output");

    const ids = (value: unknown, at: string) =>
      value === undefined
        ? []
        : list(issues, value, at).map((v, i) => text(issues, v, `${at}[${i}]`, 200));

    return issues.result({ add: ids(root.add, "add"), remove: ids(root.remove, "remove") });
  },

  document_data(output) {
    const issues = new Issues();
    const data = object(issues, object(issues, output, "The output").data, "data");

    return issues.result({ data });
  },

  installments(output) {
    const issues = new Issues();

    const installments = list(
      issues,
      object(issues, output, "The output").installments,
      "installments",
    ).map((raw, i) => {
      const item = object(issues, raw, `installments[${i}]`);
      const dueDate = typeof item.dueDate === "string" ? item.dueDate : "";

      if (!ISO_DATE.test(dueDate))
        issues.add(`installments[${i}].dueDate must be a date like 2027-03-01`);

      return { dueDate, amount: decimal(issues, item.amount, `installments[${i}].amount`) };
    });

    if (installments.length === 0) issues.add("installments must have at least one installment");

    return issues.result({ installments });
  },

  cancellation_charges(output) {
    const issues = new Issues();

    const charges = list(issues, object(issues, output, "The output").charges, "charges").map(
      (raw, i) => {
        const item = object(issues, raw, `charges[${i}]`);

        return {
          code: text(issues, item.code, `charges[${i}].code`, 100),
          description: text(issues, item.description, `charges[${i}].description`, 300),
          amount: decimal(issues, item.amount, `charges[${i}].amount`),
        };
      },
    );

    return issues.result({ charges });
  },

  field_options(output) {
    const issues = new Issues();

    const options = list(issues, object(issues, output, "The output").options, "options").map(
      (raw, i) => {
        const item = object(issues, raw, `options[${i}]`);

        return {
          value: text(issues, item.value, `options[${i}].value`, 200),
          label: text(issues, item.label, `options[${i}].label`, 200),
        };
      },
    );

    return issues.result({ options });
  },

  field_prefill(output) {
    const issues = new Issues();
    const values = object(issues, object(issues, output, "The output").values, "values");

    return issues.result({ values });
  },

  record_panel(output) {
    const issues = new Issues();
    const blocks = parseBlocks(object(issues, output, "The output").blocks, (m) => issues.add(m));

    return issues.result({ blocks });
  },

  action(output) {
    const issues = new Issues();

    const root =
      output === null || output === undefined ? {} : object(issues, output, "The output");

    const message = optionalText(issues, root.message, "message", 500);
    const blocks = root.blocks === undefined ? [] : parseBlocks(root.blocks, (m) => issues.add(m));
    let changeset: ActionResult["changeset"];

    if (root.changeset !== undefined) {
      const raw = object(issues, root.changeset, "changeset");

      if (raw.kind !== "risk_patch") issues.add('changeset.kind must be "risk_patch"');

      changeset = { kind: "risk_patch", values: object(issues, raw.values, "changeset.values") };
    }

    return issues.result({
      ...(message !== undefined && { message }),
      blocks,
      ...(changeset && { changeset }),
    });
  },

  automation() {
    return { ok: true, value: { done: true } };
  },
};

/** Checks an extension's output against its point's contract before anything uses it. */
export function parsePointOutput<P extends ExtensionPoint>(
  point: P,
  output: unknown,
): Parsed<PointOutputs[P]> {
  return (parsers[point] as Parser<P>)(output);
}
