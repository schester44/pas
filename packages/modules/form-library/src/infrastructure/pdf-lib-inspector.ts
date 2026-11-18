import { PDFDocument } from "pdf-lib";
import type { PdfInspector } from "../ports/pdf-inspector";

export class PdfLibInspector implements PdfInspector {
  async pageCount(bytes: Uint8Array): Promise<number | null> {
    try {
      return (
        await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
      ).getPageCount();
    } catch {
      return null;
    }
  }
}
