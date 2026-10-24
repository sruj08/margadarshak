// The one error type of replay and scoring. The verifier maps every code to a 422 problem.

export type ReplayErrorCode =
  | "UNSUPPORTED_GAME"
  | "UNSUPPORTED_VERSION"
  | "CONTEXT_MISMATCH"
  | "CONTENT_MISMATCH"
  | "CONTENT_NOT_FOUND"
  | "BAD_REPLAY"
  | "DIGEST_MISMATCH"
  | "BAD_EVENTS";

/** A replay that cannot be scored. */
export class ReplayError extends Error {
  readonly code: ReplayErrorCode;
  constructor(code: ReplayErrorCode, message: string) {
    super(message);
    this.name = "ReplayError";
    this.code = code;
  }
}
