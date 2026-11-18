import type { Instant, TenantContext } from "@pas/kernel";

export interface SignatureRequest {
  reference: string;
  title: string;
  document: Uint8Array;
  signer: { name: string; email?: string };
}

/** What the signer did in our embedded step, kept as evidence on the signed document. */
export interface SignatureEvidence {
  typedName: string;
  consent: string;
  signedAt: Instant;
  ipAddress: string;
  userAgent: string;
}

export interface SignedDocument {
  envelopeId: string;
  document: Uint8Array;
  sha256: string;
}

/**
 * E-signature (PLAN §10.3). The built-in provider seals click-to-sign consent captured in our UI;
 * hosted providers (DocuSign, Dropbox Sign) implement the same port and return their envelope.
 */
export interface ESignGateway {
  readonly provider: string;
  sign(
    ctx: TenantContext,
    request: SignatureRequest,
    evidence: SignatureEvidence,
  ): Promise<SignedDocument>;
}
