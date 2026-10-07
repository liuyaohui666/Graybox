import { expect, it } from "vitest";
import { CommandRetry } from "../../apps/desktop/src/retry.ts";
it("retries an ambiguous committed append with its original key and revision after refresh", () => {
  const retry = new CommandRetry();
  const payload = { experiment_id: "x", details: { summary: "same evidence" } };
  const first = retry.prepare("owner", "evidence_append", payload, 3);
  const again = retry.prepare("owner", "evidence_append", payload, 4);
  expect(again).toEqual(first);
  expect(again.expected_revision).toBe(3);
});
it("allows a fresh revision only after explicit server conflict rejection", () => {
  const retry = new CommandRetry();
  const payload = { id: "x", summary: "change" };
  const first = retry.prepare("owner", "experiment_update", payload, 3);
  retry.rejected("REVISION_CONFLICT");
  const again = retry.prepare("owner", "experiment_update", payload, 4);
  expect(again.idempotency_key).not.toBe(first.idempotency_key);
  expect(again.expected_revision).toBe(4);
});
it("keeps unknown server failures pending but clears acknowledged attempts", () => {
  const retry = new CommandRetry();
  const first = retry.prepare(
    "owner",
    "review_submit",
    { experiment_id: "x" },
    4,
  );
  retry.rejected("LOCAL_CONNECTION_ERROR");
  expect(
    retry.prepare("owner", "review_submit", { experiment_id: "x" }, 5),
  ).toEqual(first);
  retry.clear();
  expect(
    retry.prepare("owner", "review_submit", { experiment_id: "x" }, 5)
      .idempotency_key,
  ).not.toBe(first.idempotency_key);
});
