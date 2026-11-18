import type { DocumentTemplate, Jurisdiction } from "@pas/documents";
import { renderPdf } from "@pas/documents/render";
import type { TenantContext } from "@pas/kernel";
import type { NoticeDocuments } from "../ports/notice-documents";

type Input = Parameters<NoticeDocuments["render"]>[1];

/** Used when the release has no notice template for cancellations. */
const FALLBACK: DocumentTemplate = {
  key: "builtin-cancellation-notice",
  title: "Notice of cancellation",
  kind: "notice",
  page: { size: "letter", margins: "normal" },
  blocks: [
    {
      id: "header",
      type: "header",
      title: "{{notice.title}}",
      subtitle: "Policy {{policy.number}}",
    },
    {
      id: "facts",
      type: "keyValue",
      columns: 2,
      rows: [
        { label: "Named insured", value: "{{namedInsured.name}}" },
        { label: "Mailing address", value: "{{namedInsured.mailingAddress}}" },
        { label: "Policy period", value: "{{policy.effectiveDate}} – {{policy.expirationDate}}" },
        { label: "Product", value: "{{product.name}}" },
        { label: "Notice date", value: "{{notice.noticeDate}}" },
        { label: "Cancellation effective", value: "{{notice.effectiveDate}} at 12:01 a.m." },
        { label: "Reason", value: "{{notice.reason}}" },
        { label: "Return premium", value: "{{notice.returnPremium}}" },
      ],
    },
    {
      id: "body",
      type: "text",
      body: "Your policy {{policy.number}} will be cancelled effective {{notice.effectiveDate}} at 12:01 a.m. Coverage ends on that date. Any return premium due will be refunded to the original payment method.",
    },
    {
      id: "contact",
      type: "notice",
      title: "Questions",
      body: "Contact your agent, {{producer.name}}, or {{tenant.name}} at {{tenant.supportEmail}}.",
    },
  ],
};

export class ReactPdfNoticeDocuments implements NoticeDocuments {
  constructor(
    private readonly deps: {
      branding: (ctx: TenantContext) => Promise<{
        name: string;
        primaryColor: string;
        supportEmail?: string;
        supportPhone?: string;
      }>;
      jurisdictionName: (jurisdiction: Jurisdiction) => string;
    },
  ) {}

  async render(ctx: TenantContext, input: Input) {
    const { release, context, notice } = input;

    const scheduled = new Set(
      release.documents.schedule
        .filter(
          (entry) => entry.attachTo.includes("cancellation") && entry.document.kind === "template",
        )
        .map((entry) => (entry.document as { key: string }).key),
    );

    const template =
      release.documents.templates.find((t) => t.kind === "notice" && scheduled.has(t.key)) ??
      release.documents.templates.find(
        (t) => t.kind === "notice" && /cancel/i.test(`${t.key} ${t.title}`),
      ) ??
      FALLBACK;

    const pdf = await renderPdf({
      template,
      context: {
        ...context,
        tenant: await this.deps.branding(ctx),
        policy: {
          ...context.policy,
          jurisdictionName: this.deps.jurisdictionName(context.policy.jurisdiction),
        },
        forms: [],
        notice: {
          title: notice.title,
          reason: notice.reasonLabel,
          noticeDate: notice.noticeDate,
          effectiveDate: notice.effectiveDate,
          minDaysNotice: notice.minDaysNotice,
          returnPremium: notice.returnPremium,
        },
      },
      clauses: release.documents.clauses,
      schema: release.riskSchema,
    });

    return { pdf, title: notice.title };
  }
}
