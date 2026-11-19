import { invalid, workflowRef } from "@pas/kernel";

const text = (value: unknown, name: string, workflow: string) => {
  if (typeof value !== "string" || value.length === 0) throw invalid(`${workflow} needs ${name}`);

  return value;
};

export interface AgencyAccountWorkflowInput {
  agencyId: string;
  cutoff: string;
}

/** One agency's account current: issued after the cut-off, then aged until it's paid (PLAN §13). */
export const agencyAccountWorkflow = workflowRef<AgencyAccountWorkflowInput>(
  "billing.agency_account",
  {
    parse(value) {
      const input = (value ?? {}) as Partial<AgencyAccountWorkflowInput>;

      return {
        agencyId: text(input.agencyId, "an agencyId", "billing.agency_account"),
        cutoff: text(input.cutoff, "a cutoff", "billing.agency_account"),
      };
    },
  },
);

export interface MortgageeBillWorkflowInput {
  mortgageeBillId: string;
  attempt: number;
}

/** A lender's bill: the invoice packet, reminders, the direct-bill offer, nonpayment (PLAN §13). */
export const mortgageeBillWorkflow = workflowRef<MortgageeBillWorkflowInput>(
  "billing.mortgagee_bill",
  {
    parse(value) {
      const input = (value ?? {}) as Partial<MortgageeBillWorkflowInput>;

      return {
        mortgageeBillId: text(input.mortgageeBillId, "a mortgageeBillId", "billing.mortgagee_bill"),
        attempt: typeof input.attempt === "number" ? input.attempt : 1,
      };
    },
  },
);
