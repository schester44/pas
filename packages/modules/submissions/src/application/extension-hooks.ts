import {
  type BindingInvoker,
  bindingsAt,
  failurePolicyOf,
  prepareWith,
  validateWith,
  type RunSubject,
} from "@pas/extension-points";
import {
  DomainError,
  type Jurisdiction,
  type Money,
  type PlainDate,
  type TenantContext,
} from "@pas/kernel";
import { checkSplit, type InstallmentSplit, type PayPlan } from "@pas/pay-plans";
import type { PayPlanOffer } from "../domain/pay-plan-offers";
import type { TaxFeeLine } from "../domain/taxes-fees";
import type { UnderwritingReason } from "../domain/underwriting";
import type { CatalogRelease } from "../ports/product-catalog";

export interface RiskHookInput {
  release: CatalogRelease;
  risk: Record<string, unknown>;
  jurisdiction: Jurisdiction;
  effectiveDate: string;
  transaction: string;
  subject?: RunSubject;
}

const context = (input: RiskHookInput) => ({
  risk: input.risk,
  jurisdiction: input.jurisdiction,
  market: input.release.market,
  product: { id: input.release.productId, version: input.release.version },
  effectiveDate: input.effectiveDate,
  transaction: input.transaction,
});

export const prepareRisk = (invoker: BindingInvoker, ctx: TenantContext, input: RiskHookInput) =>
  prepareWith(invoker, ctx, input.release.extensions, context(input), input.subject);

export const validateRisk = (invoker: BindingInvoker, ctx: TenantContext, input: RiskHookInput) =>
  validateWith(invoker, ctx, input.release.extensions, context(input), input.subject);

/** `underwrite` bindings become underwriting reasons next to the decision tables'. */
export async function underwriteRisk(
  invoker: BindingInvoker,
  ctx: TenantContext,
  input: RiskHookInput & { quote: Record<string, unknown> },
): Promise<UnderwritingReason[]> {
  const bindings = bindingsAt(input.release.extensions, "underwrite");

  const outputs = await Promise.all(
    bindings.map(async (binding) => ({
      binding,
      output: await invoker.invoke(
        ctx,
        binding,
        { ...context(input), quote: input.quote },
        input.subject,
      ),
    })),
  );

  return outputs.flatMap(({ binding, output }) =>
    (output?.outcomes ?? []).flatMap((row): UnderwritingReason[] =>
      row.outcome === "accept"
        ? []
        : [
            {
              source: "extension",
              decision: binding.label ?? `extension.${binding.id}`,
              rule: row.reasonCode,
              outcome: row.outcome,
              reasonCode: row.reasonCode,
              message: row.message,
              ...(row.authority && { authority: row.authority }),
            },
          ],
    ),
  );
}

/**
 * The `installments` binding, asked once per offered multi-installment plan. A split that
 * doesn't add up (or is out of order) is the extension's failure, under its failure policy.
 */
export async function installmentSplits(
  invoker: BindingInvoker,
  ctx: TenantContext,
  input: RiskHookInput & {
    offers: readonly PayPlanOffer[];
    plans: readonly PayPlan[];
    premium: Money;
    taxesFees: readonly TaxFeeLine[];
    termStart: PlainDate;
    termEnd: PlainDate;
    today: PlainDate;
  },
): Promise<Map<string, InstallmentSplit[]>> {
  const splits = new Map<string, InstallmentSplit[]>();
  const [binding] = bindingsAt(input.release.extensions, "installments");

  if (!binding) return splits;

  for (const offer of input.offers) {
    const plan = input.plans.find((p) => p.key === offer.key);

    if (!plan || offer.installments <= 1) continue;

    const output = await invoker.invoke(
      ctx,
      binding,
      {
        ...context(input),
        plan: {
          key: plan.key,
          label: plan.label,
          installments: plan.installments,
          intervalMonths: plan.intervalMonths,
          downPayment: plan.downPayment,
        },
        premium: input.premium.toString(),
        currency: input.premium.currency,
        taxesFees: input.taxesFees.map((t) => ({
          code: t.code,
          label: t.label,
          amount: t.amount.toString(),
        })),
        termStart: input.termStart.toString(),
        termEnd: input.termEnd.toString(),
        billedOn: input.today.toString(),
        standard: offer.schedule,
      },
      input.subject,
    );

    if (!output) continue;

    const split = output.installments.map((i) => ({ dueOn: i.dueDate, premium: i.amount }));
    const issues = checkSplit(split, input);

    if (issues.length === 0) {
      splits.set(plan.key, split);
    } else if (failurePolicyOf(binding) === "block") {
      throw new DomainError(
        "precondition_failed",
        `The installment extension's schedule for ${plan.label} doesn't work: ${issues.join("; ")}`,
        { reason: "extension_failed", bindingId: binding.id },
      );
    }
  }

  return splits;
}
