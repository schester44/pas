import { type BindingInvoker, bindingsAt, noExtensions } from "@pas/extension-points";
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

const INTENT: DocumentTemplate = {
  ...FALLBACK,
  key: "builtin-nonpayment-intent",
  title: "Notice of intent to cancel for nonpayment",
  blocks: [
    FALLBACK.blocks[0]!,
    {
      id: "facts",
      type: "keyValue",
      columns: 2,
      rows: [
        { label: "Named insured", value: "{{namedInsured.name}}" },
        { label: "Mailing address", value: "{{namedInsured.mailingAddress}}" },
        { label: "Policy period", value: "{{policy.effectiveDate}} – {{policy.expirationDate}}" },
        { label: "Notice date", value: "{{notice.noticeDate}}" },
        { label: "Amount past due", value: "{{notice.amountDue}}" },
        { label: "Cancels on", value: "{{notice.effectiveDate}} at 12:01 a.m. unless paid" },
        { label: "Reason", value: "{{notice.reason}}" },
      ],
    },
    {
      id: "body",
      type: "text",
      body: "We haven't received {{notice.amountDue}} due on policy {{policy.number}}. Unless we receive it before {{notice.effectiveDate}}, your policy will be cancelled effective {{notice.effectiveDate}} at 12:01 a.m. If you pay the past-due amount before then, the cancellation is withdrawn and your coverage continues without interruption.",
    },
    FALLBACK.blocks[3]!,
  ],
};

const RESCISSION: DocumentTemplate = {
  ...FALLBACK,
  key: "builtin-cancellation-rescinded",
  title: "Cancellation rescinded",
  blocks: [
    FALLBACK.blocks[0]!,
    {
      id: "body",
      type: "text",
      body: "We received your payment. The cancellation of policy {{policy.number}} scheduled for {{notice.effectiveDate}} has been withdrawn, and your coverage continues without interruption.",
    },
    FALLBACK.blocks[3]!,
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
      extensions?: BindingInvoker;
    },
  ) {}

  /** `document_data` for notices: values templates merge as `extension.*`. */
  private async extensionData(ctx: TenantContext, input: Input) {
    const bindings = bindingsAt(input.release.extensions, "document_data");

    if (bindings.length === 0) return undefined;

    const hook = {
      jurisdiction: input.context.policy.jurisdiction,
      product: { id: input.release.productId, version: input.release.version },
      policy: { number: input.context.policy.number ?? null },
      risk: input.context.risk,
      notice: {
        kind: input.notice.kind,
        reason: input.notice.reasonLabel,
        effectiveDate: input.notice.effectiveDate,
      },
    };

    const outputs = await Promise.all(
      bindings.map((b) => (this.deps.extensions ?? noExtensions).invoke(ctx, b, hook)),
    );

    return Object.assign({}, ...outputs.map((o) => o?.data ?? {})) as Record<string, unknown>;
  }

  async render(ctx: TenantContext, input: Input) {
    const { release, context, notice } = input;
    const extension = await this.extensionData(ctx, input);

    const scheduled = new Set(
      release.documents.schedule
        .filter(
          (entry) => entry.attachTo.includes("cancellation") && entry.document.kind === "template",
        )
        .map((entry) => (entry.document as { key: string }).key),
    );

    const builtin =
      notice.kind === "intent" ? INTENT : notice.kind === "rescission" ? RESCISSION : null;

    const template =
      builtin ??
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
        ...(extension && { extension }),
        notice: {
          title: notice.title,
          reason: notice.reasonLabel,
          noticeDate: notice.noticeDate,
          effectiveDate: notice.effectiveDate,
          minDaysNotice: notice.minDaysNotice,
          returnPremium: notice.returnPremium,
          ...(notice.amountDue && { amountDue: notice.amountDue }),
        },
      },
      clauses: release.documents.clauses,
      schema: release.riskSchema,
    });

    return { pdf, title: notice.title };
  }
}
