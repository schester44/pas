export type DecisionErrorCode =
  | "invalid_jdm"
  | "unsupported_node"
  | "evaluation_failed"
  | "contract_violation";

export class DecisionError extends Error {
  constructor(
    readonly code: DecisionErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DecisionError";
  }
}
