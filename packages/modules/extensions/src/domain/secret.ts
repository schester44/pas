export interface SealedSecret {
  keyId: string;
  iv: string;
  data: string;
  tag: string;
}

export interface StoredSecret {
  name: string;
  sealed: SealedSecret;
  hint: string;
  updatedAt: string;
}

/** What the admin may see of a secret: its name and the last few characters. */
export const hintOf = (value: string) => (value.length <= 8 ? "••••" : `••••${value.slice(-4)}`);

/** Each secret is sealed to its tenant, extension and name, so a copied row won't open elsewhere. */
export const secretContext = (tenantId: string, extensionId: string, name: string) =>
  `extension:${tenantId}:${extensionId}:${name}`;
