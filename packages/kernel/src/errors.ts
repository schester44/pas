/**
 * Expected business failures. Delivery adapters (tRPC/REST) map `code` to transport errors.
 * Throw plain `Error` for bugs; throw `DomainError` for things a user can act on.
 */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export type DomainErrorCode =
  | "not_found"
  | "conflict"
  | "invalid"
  | "forbidden"
  | "precondition_failed";

export const notFound = (entity: string, id: string) =>
  new DomainError("not_found", `${entity} ${id} not found`, { entity, id });

export const invalid = (message: string, details?: Record<string, unknown>) =>
  new DomainError("invalid", message, details);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new DomainError("conflict", message, details);
