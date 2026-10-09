export function reviewQueue<T extends { status: string }>(items: T[]): T[] {
  return items.filter((item) => item.status === "waiting_for_review");
}
export function evidenceLabel(result: string): string {
  return (
    (
      {
        passed: "报告通过",
        failed: "报告失败",
        not_run: "未执行",
        inconclusive: "尚无结论",
      } as Record<string, string>
    )[result] ?? result
  );
}
export function statusLabel(status: string): string {
  return (
    (
      {
        idea: "想法",
        experimenting: "实验中",
        waiting_for_review: "待验收",
        validated: "验证成功",
        in_development: "正式开发",
        paused: "暂停",
        rejected: "放弃",
        completed: "已完成",
        revive_later: "待复活",
      } as Record<string, string>
    )[status] ?? status
  );
}
export function command(
  type: string,
  payload: object,
  revision?: number,
  batchId: string = crypto.randomUUID(),
  requestId: string = crypto.randomUUID(),
) {
  return {
    type,
    payload,
    ...(revision === undefined ? {} : { expected_revision: revision }),
    batch_id: batchId,
    idempotency_key: requestId,
  };
}
export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  lifecycle: string;
  priority: string;
  tags: string[];
  creator_name?: string | null;
  creator_id?: string | null;
  project_role?: "owner" | "member";
  owner_id?: string | null;
  owner_name?: string | null;
  can_edit: boolean;
  workspace_id: string;
  revision: number;
  updated_at: string;
}
export interface Evidence {
  id: string;
  type: string;
  result: string;
  source_kind: string;
  details: Record<string, unknown>;
  created_at: string;
}
export interface Experiment {
  id: string;
  project_id: string;
  series_id: string;
  version: number;
  name: string;
  goal: string;
  summary: string;
  change_summary: string;
  status: string;
  revision: number;
  updated_at: string;
  evidence?: Evidence[];
  submissions?: {
    id: string;
    created_at: string;
    snapshot: Record<string, unknown>;
  }[];
}
export interface Activity {
  id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  batch_id: string;
  agent_id?: string;
  human_id: string;
  project_id: string;
  created_at?: string;
  timestamp?: string;
  before: unknown;
  after: unknown;
}
export interface UndoPreview {
  batch_id: string;
  batch_revision: number;
  preview_token: string;
  expires_at: string;
  request_id?: string;
  changes: {
    entity_type: string;
    entity_id: string;
    before: unknown;
    after: unknown;
    expected_revision: number;
  }[];
}
