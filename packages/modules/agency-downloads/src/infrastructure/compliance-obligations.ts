import type { TrackObligations } from "@pas/compliance";
import type { TenantContext } from "@pas/kernel";
import type { DownloadObligations } from "../ports/sources";

/** Each download as an `ams_download` obligation the tenant owes, met by delivery (PLAN §17.4). */
export function complianceDownloadObligations(
  tracked: TrackObligations,
  tenantName: (ctx: TenantContext) => Promise<string>,
): DownloadObligations {
  return {
    async open(ctx, input) {
      return tracked.open(ctx, {
        dedupeKey: input.dedupeKey,
        kind: "ams_download",
        code: "AMS_DOWNLOAD",
        title: input.title,
        jurisdiction: input.jurisdiction,
        responsible: { type: "tenant", name: await tenantName(ctx) },
        channel: "api",
        subject: {
          policyId: input.policy?.id ?? null,
          policyNumber: input.policy?.number ?? null,
          termId: input.policy?.termId ?? null,
          transactionId: input.transaction?.id ?? null,
          transactionType: input.transaction?.type ?? null,
        },
        dueDate: input.dueDate,
        data: input.data,
        source: "agency_downloads",
      });
    },

    async settle(ctx, input) {
      await tracked.settle(ctx, { ...input, actor: "Agency downloads" });
    },
  };
}
