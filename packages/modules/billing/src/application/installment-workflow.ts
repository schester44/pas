import { invalid, workflowRef } from "@pas/kernel";

export interface InstallmentWorkflowInput {
  invoiceId: string;
}

/** One installment from issue to paid, charged, past due or delinquent (PLAN §13). */
export const installmentWorkflow = workflowRef<InstallmentWorkflowInput>("billing.installment", {
  parse(value) {
    const invoiceId = (value as Partial<InstallmentWorkflowInput> | null)?.invoiceId;

    if (typeof invoiceId !== "string" || invoiceId.length === 0) {
      throw invalid("billing.installment needs an invoiceId");
    }

    return { invoiceId };
  },
});
