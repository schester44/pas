import { migration } from "../types";

const tag = (type: string, id: string) => `'${type}:' || ${id}`;

const BACKFILLS = [
  `UPDATE workflows.runs r
   SET subjects = array_remove(ARRAY[
     ${tag("policy", "t.policy_id::text")},
     ${tag("term", "t.id::text")},
     ${tag("transaction", "(r.input->>'transactionId')")}
   ], NULL)
   FROM policy_terms t
   WHERE r.subjects = '{}' AND r.workflow_id IN ('policy.term', 'policy.cancellation')
     AND t.tenant_id = r.tenant_id AND t.id::text = r.input->>'termId'`,
  `UPDATE workflows.runs r
   SET subjects = ARRAY[${tag("policy", "i.policy_id::text")}, ${tag("invoice", "i.id::text")}]
   FROM invoices i
   WHERE r.subjects = '{}' AND r.workflow_id = 'billing.installment'
     AND i.tenant_id = r.tenant_id AND i.id::text = r.input->>'invoiceId'`,
  `UPDATE workflows.runs r
   SET subjects = ARRAY[
     ${tag("policy", "m.policy_id::text")},
     ${tag("invoice", "m.invoice_id::text")},
     ${tag("mortgagee_bill", "m.id::text")}
   ]
   FROM mortgagee_bills m
   WHERE r.subjects = '{}' AND r.workflow_id = 'billing.mortgagee_bill'
     AND m.tenant_id = r.tenant_id AND m.id::text = r.input->>'mortgageeBillId'`,
  `UPDATE workflows.runs r
   SET subjects = ARRAY[${tag("agency", "(r.input->>'agencyId')")}]
   WHERE r.subjects = '{}' AND r.workflow_id = 'billing.agency_account' AND r.input ? 'agencyId'`,
  `UPDATE workflows.runs r
   SET subjects = array_remove(ARRAY[
     ${tag("policy", "o.policy_id::text")},
     ${tag("transaction", "o.transaction_id::text")},
     ${tag("obligation", "o.id::text")},
     ${tag("filing", "(r.input->>'filingId')")}
   ], NULL)
   FROM compliance_obligations o
   WHERE r.subjects = '{}' AND r.workflow_id IN ('compliance.obligation', 'compliance.filing')
     AND o.tenant_id = r.tenant_id AND o.id::text = r.input->>'obligationId'`,
  `UPDATE workflows.runs r
   SET subjects = array_remove(ARRAY[
     ${tag("policy", "u.policy_id::text")},
     ${tag("quote", "u.quote_id::text")},
     ${tag("submission", "u.submission_id::text")},
     ${tag("inspection", "u.id::text")}
   ], NULL)
   FROM underwriting_inspections u
   WHERE r.subjects = '{}' AND r.workflow_id = 'underwriting.inspection'
     AND u.tenant_id = r.tenant_id AND u.id::text = r.input->>'inspectionId'`,
  `UPDATE workflows.runs r
   SET subjects = array_remove(ARRAY[
     ${tag("policy", "u.policy_id::text")},
     ${tag("quote", "u.quote_id::text")},
     ${tag("submission", "u.submission_id::text")},
     ${tag("subjectivity", "u.id::text")}
   ], NULL)
   FROM underwriting_subjectivities u
   WHERE r.subjects = '{}' AND r.workflow_id = 'underwriting.subjectivity'
     AND u.tenant_id = r.tenant_id AND u.id::text = r.input->>'subjectivityId'`,
  `UPDATE workflows.runs r
   SET subjects = ARRAY[
     ${tag("quote", "(r.input->>'quoteId')")},
     ${tag("submission", "(r.input->>'submissionId')")}
   ]
   WHERE r.subjects = '{}' AND r.workflow_id = 'quote.journey' AND r.input ? 'quoteId'`,
];

/** Tags runs started before run subjects existed with the records named by their input. */
export default migration({
  name: "20261119-02-workflow-run-subjects",
  async up({ db }) {
    const [state] = await db.$queryRawUnsafe<{ installed: boolean }[]>(
      `SELECT to_regclass('workflows.runs') IS NOT NULL AS installed`,
    );

    if (!state?.installed) return;

    await db.$executeRawUnsafe(
      `ALTER TABLE workflows.runs ADD COLUMN IF NOT EXISTS subjects text[] NOT NULL DEFAULT '{}'`,
    );

    for (const sql of BACKFILLS) await db.$executeRawUnsafe(sql);
  },
});
