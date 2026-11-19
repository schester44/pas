import { newId, type TenantContext } from "@pas/kernel";
import { agencyCodeFor } from "../domain/enrollment";
import { reconcile, toDownloadRecord } from "../domain/record";
import { SAMPLE_SCENARIOS, sampleView } from "../domain/samples";
import type { DownloadFormatId } from "../domain/settings";
import type { AgencyDownloadsDeps } from "./deps";
import { formatFor } from "./deliver";

const SAMPLE_ENROLLMENT = {
  accountCode: "YTEST",
  mailbox: null,
  agencyCodes: [{ carrier: "", code: "A0001" }],
};

/**
 * The certification test harness: one file per canned scenario on a sample policy, built through
 * the same mapping and format as live downloads, for submission to IVANS during certification.
 */
export function makeGenerateSamples(deps: AgencyDownloadsDeps) {
  return {
    async linesOfBusiness(ctx: TenantContext) {
      return deps.transactions.linesOfBusiness(ctx);
    },

    async generate(
      ctx: TenantContext,
      input: { format: DownloadFormatId; lineOfBusiness: string; agencyId?: string },
    ) {
      const channel = await deps.channels.active(ctx);
      const format = formatFor(deps, input.format);

      const enrollment =
        (input.agencyId &&
          (await deps.uow.run(ctx, (tx) =>
            deps.enrollments.findByAgency(tx, ctx, input.agencyId!),
          ))) ||
        SAMPLE_ENROLLMENT;

      const agencyName =
        (await deps.agencies.agencies(ctx)).find((a) => a.id === input.agencyId)?.name ??
        "Sample Agency";

      const settings = {
        lobCodes: channel?.settings.lobCodes ?? {},
        coverageCodes: channel?.settings.coverageCodes ?? {},
      };

      const now = deps.clocks.forTenant(ctx.tenantId).now();
      const tenantName = await deps.tenantName(ctx);

      return SAMPLE_SCENARIOS.map((scenario) => {
        const view = sampleView(scenario.id, {
          lineOfBusiness: input.lineOfBusiness,
          agency: { id: input.agencyId ?? "sample-agency", name: agencyName },
        });

        const record = toDownloadRecord(view, { kind: scenario.kind, enrollment, settings });
        const fileId = newId();

        const content = format.policyFile(
          {
            fileId,
            createdAt: now,
            sender: { participantCode: channel?.settings.participantCode ?? "", name: tenantName },
            recipient: { accountCode: enrollment.accountCode, mailbox: enrollment.mailbox },
            test: true,
          },
          [record],
          [],
        );

        return {
          scenario: scenario.id,
          label: scenario.label,
          fileName: `SAMPLE-${scenario.id.toUpperCase()}-${agencyCodeFor(enrollment) ?? "AGENCY"}.${format.extension}`,
          contentType: format.contentType,
          content,
          issues: reconcile(record, view.transaction.premium),
        };
      });
    },
  };
}

export type GenerateSamples = ReturnType<typeof makeGenerateSamples>;
