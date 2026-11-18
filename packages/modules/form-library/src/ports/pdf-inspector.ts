export interface PdfInspector {
  /** Page count of a readable PDF, or null when the bytes aren't one. */
  pageCount(bytes: Uint8Array): Promise<number | null>;
}
