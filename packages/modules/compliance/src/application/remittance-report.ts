import { conflict, type TenantContext } from "@pas/kernel";
import { remittanceReport } from "../domain/remittance";
import { type ComplianceDeps, loadObligation } from "./deps";

const csvCell = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

/** The remittance statement for a period obligation, as CSV for the licensee's tax filing (PLAN §17.2.8). */
export function makeRemittanceReport(deps: Pick<ComplianceDeps, "uow" | "obligations">) {
  return async function remittanceReportFor(ctx: TenantContext, input: { obligationId: string }) {
    return deps.uow.run(ctx, async (tx) => {
      const period = (await loadObligation(deps, tx, ctx, input.obligationId)).toSnapshot();

      if (
        period.subject.type !== "period" ||
        !period.subject.periodStart ||
        !period.subject.periodEnd
      ) {
        throw conflict("Only periodic obligations have a remittance report");
      }

      const covered = await deps.obligations.inPeriod(tx, ctx, {
        kind: period.data.aggregates as never,
        jurisdiction: period.jurisdiction.subdivision ?? period.jurisdiction.country,
        licenseeId: period.responsible.licensee?.id ?? null,
        from: period.subject.periodStart,
        to: period.subject.periodEnd,
      });

      const filed = covered.map((o) => o.toSnapshot()).filter((o) => o.status !== "waived");

      const currency =
        (filed[0]?.data.premium as { currency?: string } | undefined)?.currency ?? "USD";

      const report = remittanceReport(filed, currency);
      const codes = report.taxes.map((t) => t.code);

      const rows = [
        [
          "Policy",
          "Insured",
          "Transaction",
          "Effective",
          "Issued",
          "Filing number",
          "Premium",
          ...codes,
        ],
        ...report.lines.map((l) => [
          l.policyNumber,
          l.insuredName,
          l.transactionType.toLowerCase().replaceAll("_", " "),
          l.effectiveDate,
          l.issuedDate,
          l.filingNumber ?? "",
          l.premium.round(2).toString(),
          ...codes.map(
            (c) =>
              l.taxes
                .find((t) => t.code === c)
                ?.amount.round(2)
                .toString() ?? "0",
          ),
        ]),
        [
          "Total",
          "",
          "",
          "",
          "",
          "",
          report.premium.round(2).toString(),
          ...report.taxes.map((t) => t.amount.round(2).toString()),
        ],
      ];

      const licensee = period.responsible.licensee?.licenseNumber ?? "tenant";
      const state = period.jurisdiction.subdivision ?? period.jurisdiction.country;

      return {
        fileName: `${state}-${licensee}-${period.subject.periodStart}-remittance.csv`,
        contentType: "text/csv",
        body: new TextEncoder().encode(`${rows.map((r) => r.map(csvCell).join(",")).join("\n")}\n`),
        summary: {
          transactions: report.lines.length,
          premium: report.premium.round(2).toJSON(),
          taxes: report.taxes.map((t) => ({
            code: t.code,
            label: t.label,
            amount: t.amount.round(2).toJSON(),
          })),
          total: report.total.round(2).toJSON(),
        },
      };
    });
  };
}

export type RemittanceReportFor = ReturnType<typeof makeRemittanceReport>;
