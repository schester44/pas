/** Object storage port: documents, uploads, large integration payloads, rating traces. */
export interface ObjectStorage {
  put(input: { key: string; body: Uint8Array; contentType: string }): Promise<{ key: string }>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}
