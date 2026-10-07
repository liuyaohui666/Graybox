import { command } from "./model.ts";
export class CommandRetry {
  private pending: {
    signature: string;
    body: ReturnType<typeof command>;
  } | null = null;
  prepare(profile: string, type: string, payload: object, revision?: number) {
    // A refresh must not change the identity or revision of an ambiguous attempt.
    const signature = JSON.stringify({ profile, type, payload });
    if (!this.pending || this.pending.signature !== signature)
      this.pending = { signature, body: command(type, payload, revision) };
    return this.pending.body;
  }
  clear() {
    this.pending = null;
  }
  rejected(code?: string) {
    if (
      code &&
      [
        "VALIDATION",
        "REVISION_CONFLICT",
        "FORBIDDEN",
        "UNAUTHORIZED",
        "NOT_FOUND",
        "INVALID_TRANSITION",
        "BATCH_CLOSED",
        "IDEMPOTENCY_MISMATCH",
      ].includes(code)
    )
      this.clear();
  }
}
