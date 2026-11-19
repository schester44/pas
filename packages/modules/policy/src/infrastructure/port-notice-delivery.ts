import type { TenantContext } from "@pas/kernel";
import type { NoticeAddress, NoticeDelivery } from "../ports/notice-delivery";

type MailType = "first_class" | "certified" | "certified_return_receipt";

interface PostalAddress extends NoticeAddress {
  name: string;
  country: string;
}

const mailTypeOf = (delivery: string): MailType =>
  delivery.includes("return_receipt")
    ? "certified_return_receipt"
    : delivery.includes("certified") && !delivery.includes("certificate")
      ? "certified"
      : "first_class";

/** Delivers notices through the tenant's email and print & mail integrations. */
export class PortNoticeDelivery implements NoticeDelivery {
  constructor(
    private readonly deps: {
      emails(ctx: TenantContext, policyId: string): Promise<string[]>;
      sendEmail(
        ctx: TenantContext,
        message: { to: string; subject: string; text: string; tag: string },
      ): Promise<void>;
      sendLetter(
        ctx: TenantContext,
        input: {
          reference: {
            kind: "policy_notice";
            policyId: string;
            transactionId: string;
            title: string;
          };
          letter: {
            reference: string;
            description: string;
            to: PostalAddress;
            from: PostalAddress;
            mailType: MailType;
            document: Uint8Array;
          };
        },
      ): Promise<unknown>;
      returnAddress(ctx: TenantContext): Promise<PostalAddress>;
    },
  ) {}

  async deliver(ctx: TenantContext, input: Parameters<NoticeDelivery["deliver"]>[1]) {
    const emailed: string[] = [];
    const mailed: string[] = [];

    if (input.recipients.includes("insured")) {
      for (const to of await this.deps.emails(ctx, input.policyId)) {
        await this.deps.sendEmail(ctx, {
          to,
          tag: "policy_notice",
          subject: `${input.title}: policy ${input.policyNumber}`,
          text: `${input.title} for policy ${input.policyNumber} is in your client portal. Sign in to read it and see what's owed.`,
        });

        emailed.push(to);
      }
    }

    if (input.delivery === "electronic") return { emailed, mailed };

    const from = await this.deps.returnAddress(ctx);

    const addressees = [
      ...(input.insured.address
        ? [{ name: input.insured.name, address: input.insured.address }]
        : []),
      ...input.interests.flatMap((i) => (i.address ? [{ name: i.name, address: i.address }] : [])),
    ];

    for (const [index, addressee] of addressees.entries()) {
      await this.deps.sendLetter(ctx, {
        reference: {
          kind: "policy_notice",
          policyId: input.policyId,
          transactionId: input.transactionId,
          title: input.title,
        },
        letter: {
          reference: `${input.transactionId}:${index}`,
          description: `${input.title}, ${input.policyNumber}`,
          to: {
            ...addressee.address,
            name: addressee.name,
            country: addressee.address.country ?? "US",
          },
          from,
          mailType: mailTypeOf(input.delivery),
          document: input.pdf,
        },
      });

      mailed.push(addressee.name);
    }

    return { emailed, mailed };
  }
}
