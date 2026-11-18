import { prismaTx } from "@pas/db";
import type { TenantContext, Transaction } from "@pas/kernel";
import type { MailType } from "../ports/adapters";
import type {
  MailPieceRecord,
  MailPieces,
  MailProof,
  MailReference,
  TrackingEntry,
} from "../ports/mail-pieces";
import { json, toDate, toInstant } from "./mappers";

export class PrismaMailPieces implements MailPieces {
  async find(tx: Transaction, ctx: TenantContext, providerId: string, providerRef: string) {
    const row = await prismaTx(tx).mailPiece.findUnique({
      where: {
        tenantId_providerId_providerRef: { tenantId: ctx.tenantId, providerId, providerRef },
      },
    });

    return (
      row && {
        id: row.id,
        installId: row.installId,
        providerId: row.providerId,
        providerRef: row.providerRef,
        reference: row.reference as unknown as MailReference,
        mailType: row.mailType as MailType,
        status: row.status,
        trackingNumber: row.trackingNumber,
        tracking: row.tracking as unknown as TrackingEntry[],
        proof: row.proof as unknown as MailProof | null,
        createdAt: toInstant(row.createdAt),
        updatedAt: toInstant(row.updatedAt),
      }
    );
  }

  async save(tx: Transaction, ctx: TenantContext, piece: MailPieceRecord): Promise<void> {
    const data = {
      status: piece.status,
      trackingNumber: piece.trackingNumber,
      tracking: json(piece.tracking),
      proof: piece.proof ? json(piece.proof) : undefined,
      updatedAt: toDate(piece.updatedAt),
    };

    await prismaTx(tx).mailPiece.upsert({
      where: { id: piece.id },
      create: {
        id: piece.id,
        tenantId: ctx.tenantId,
        installId: piece.installId,
        providerId: piece.providerId,
        providerRef: piece.providerRef,
        reference: json(piece.reference),
        mailType: piece.mailType,
        createdAt: toDate(piece.createdAt),
        ...data,
      },
      update: data,
    });
  }
}
