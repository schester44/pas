import { newId, sha256, type TenantContext } from "@pas/kernel";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type {
  ESignGateway,
  SignatureEvidence,
  SignatureRequest,
  SignedDocument,
} from "../ports/esign-gateway";

const INK = rgb(0.094, 0.094, 0.106);
const MUTED = rgb(0.443, 0.443, 0.478);
const RULE = rgb(0.894, 0.894, 0.906);

/**
 * The built-in provider: consent captured in our UI, sealed by stamping every page and appending a
 * signature certificate with the evidence (typed name, time, IP, user agent, document hash).
 */
export class ClickToSignGateway implements ESignGateway {
  readonly provider = "click_to_sign";

  async sign(
    _ctx: TenantContext,
    request: SignatureRequest,
    evidence: SignatureEvidence,
  ): Promise<SignedDocument> {
    const envelopeId = `env_${newId()}`;
    const originalHash = await sha256(request.document);
    const pdf = await PDFDocument.load(request.document, { ignoreEncryption: true });
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const signedAt = evidence.signedAt.toString();

    for (const page of pdf.getPages()) {
      const stamp = `Signed electronically by ${evidence.typedName} · ${signedAt} · ${envelopeId}`;

      page.drawText(printable(stamp), {
        x: 36,
        y: 16,
        size: 6.5,
        font: regular,
        color: MUTED,
      });
    }

    const page = pdf.addPage([612, 792]);
    let y = 720;

    const line = (label: string, value: string) => {
      page.drawText(label, { x: 54, y, size: 8, font: regular, color: MUTED });

      for (const [index, chunk] of wrap(value, 78).entries()) {
        page.drawText(printable(chunk), {
          x: 190,
          y: y - index * 12,
          size: 9.5,
          font: regular,
          color: INK,
        });
      }

      y -= 12 * Math.max(1, wrap(value, 78).length) + 10;
    };

    page.drawText("Signature certificate", { x: 54, y, size: 16, font: bold, color: INK });
    y -= 22;
    page.drawText(printable(request.title), { x: 54, y, size: 9.5, font: regular, color: MUTED });
    y -= 22;
    page.drawLine({ start: { x: 54, y }, end: { x: 558, y }, thickness: 0.75, color: RULE });
    y -= 26;

    page.drawText(printable(evidence.typedName), { x: 54, y, size: 22, font: bold, color: INK });
    y -= 12;
    page.drawLine({ start: { x: 54, y }, end: { x: 300, y }, thickness: 0.75, color: INK });
    y -= 14;
    page.drawText("Signature", { x: 54, y, size: 8, font: regular, color: MUTED });
    y -= 34;

    line("Signer", request.signer.name);
    line("Signed at", signedAt);
    line("IP address", evidence.ipAddress);
    line("User agent", evidence.userAgent);
    line("Consent", evidence.consent);
    line("Envelope", envelopeId);
    line("Document SHA-256", originalHash);
    line("Method", "Typed name and checkbox, embedded click-to-sign");

    const bytes = await pdf.save();

    return { envelopeId, document: bytes, sha256: await sha256(bytes) };
  }
}

// Standard PDF fonts only encode WinAnsi; anything else would throw while drawing.
const printable = (text: string) => text.replace(/[^\x20-\x7e\xa0-\xff\u2013\u2014\u00b7]/g, "?");

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const chunks = word.match(new RegExp(`.{1,${width}}`, "g")) ?? [word];

    for (const chunk of chunks) {
      if (`${current} ${chunk}`.trim().length > width) {
        lines.push(current);
        current = chunk;
      } else {
        current = `${current} ${chunk}`.trim();
      }
    }
  }

  if (current) lines.push(current);

  return lines;
}
