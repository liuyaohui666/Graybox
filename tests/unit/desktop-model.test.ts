import { describe, expect, it } from "vitest";
import {
  evidenceLabel,
  reviewQueue,
  command,
  statusLabel,
} from "../../apps/desktop/src/model.ts";

describe("desktop evidence and review presentation", () => {
  it("only puts explicitly submitted experiments in the review queue", () => {
    const items = [
      { id: "1", status: "experimenting" },
      { id: "2", status: "waiting_for_review" },
      { id: "3", status: "completed" },
    ];
    expect(reviewQueue(items).map((x) => x.id)).toEqual(["2"]);
  });
  it("does not describe unrun validation as a successful test", () => {
    expect(evidenceLabel("not_run")).toBe("未执行");
    expect(evidenceLabel("inconclusive")).toBe("尚无结论");
  });
  it("labels reported success without implying human approval", () => {
    expect(evidenceLabel("passed")).toBe("报告通过");
    expect(statusLabel("waiting_for_review")).toBe("待验收");
  });
  it("attaches revision to updates and keeps envelope identity fields server-owned", () => {
    const c = command(
      "experiment_update",
      { id: "one", summary: "更新" },
      8,
      "batch-id",
      "request-id",
    );
    expect(c).toEqual({
      type: "experiment_update",
      payload: { id: "one", summary: "更新" },
      expected_revision: 8,
      batch_id: "batch-id",
      idempotency_key: "request-id",
    });
    expect(c).not.toHaveProperty("actor");
  });
});
