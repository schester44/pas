import type { DocumentContext } from "@pas/documents";
import type { TenantContext } from "@pas/kernel";
import type { PolicyRelease } from "./product-config";

export interface NoticeContent {
  title: string;
  reasonLabel: string;
  noticeDate: string;
  effectiveDate: string;
  minDaysNotice: number;
  returnPremium: { amount: string; currency: string };
  kind?: "cancellation" | "intent" | "rescission";
  amountDue?: { amount: string; currency: string };
}

/** Renders a notice from the release's notice template, or a plain built-in one. */
export interface NoticeDocuments {
  render(
    ctx: TenantContext,
    input: {
      release: PolicyRelease;
      context: Omit<DocumentContext, "tenant" | "forms" | "policy"> & {
        policy: Omit<DocumentContext["policy"], "jurisdictionName">;
      };
      notice: NoticeContent;
    },
  ): Promise<{ pdf: Uint8Array; title: string }>;
}
