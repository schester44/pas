import { pdf } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { DocumentPdf, type RenderInput } from "./document";

export { DocumentPdf, type RenderInput } from "./document";

export async function renderPdf(input: RenderInput): Promise<Uint8Array> {
  const blob = await pdf(<DocumentPdf {...input} />).toBlob();

  return new Uint8Array(await blob.arrayBuffer());
}

/** Concatenates PDFs in order: rendered templates and library form editions into one packet. */
export async function mergePdfs(parts: readonly Uint8Array[]): Promise<Uint8Array> {
  const packet = await PDFDocument.create();

  for (const part of parts) {
    const source = await PDFDocument.load(part, { ignoreEncryption: true });
    const pages = await packet.copyPages(source, source.getPageIndices());

    for (const page of pages) packet.addPage(page);
  }

  return packet.save();
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
}
