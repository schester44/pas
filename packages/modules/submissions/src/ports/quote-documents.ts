import type { DocumentContext, TransactionType } from "@pas/documents";
import type { TenantContext } from "@pas/kernel";
import type { CatalogRelease } from "./product-catalog";

export interface RenderedPacket {
  pdf: Uint8Array;
  documents: { title: string; kind: "template" | "form" }[];
}

/** Builds and renders the release's packet for one or more transaction types, in that order. */
export interface QuoteDocuments {
  render(
    ctx: TenantContext,
    input: {
      release: CatalogRelease;
      context: Omit<DocumentContext, "forms" | "policy" | "tenant"> & {
        policy: Omit<DocumentContext["policy"], "transaction" | "jurisdictionName">;
      };
      transactions: readonly TransactionType[];
    },
  ): Promise<RenderedPacket>;
}
