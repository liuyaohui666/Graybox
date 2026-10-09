export interface PendingWrite { signature: string; profile: string; path: string; operation: string; credentialRevision: number; busy: boolean; ambiguous: boolean }
export class WriteSafety {
  private pending: PendingWrite | null = null;
  private listeners = new Set<() => void>();
  snapshot = () => this.pending;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private notify() { for (const listener of this.listeners) listener(); }
  begin(profile: string, path: string, body: unknown, credentialRevision: number) {
    const signature = JSON.stringify({profile,path,body});
    if (this.pending && (this.pending.busy || this.pending.signature !== signature || this.pending.credentialRevision !== credentialRevision))
      throw new Error("上次写入结果尚未确认。请使用原操作重试；重新登录后须先核对最新记录，再解除未确认标记。");
    this.pending = {signature,profile,path,operation: typeof body === "object" && body && "type" in body ? String(body.type) : path.endsWith("/agreement") ? "赞同" : path === "/v1/profile/name" ? "昵称修改" : path === "/v1/notifications/read" ? "消息已读" : "批次撤销", credentialRevision,busy:true,ambiguous:this.pending?.ambiguous ?? false};
    this.notify(); return this.pending;
  }
  finish(attempt: PendingWrite, success: boolean, definitive = false) {
    if (this.pending !== attempt) return;
    this.pending = success || (definitive && !attempt.ambiguous) ? null : {...attempt,busy:false,ambiguous:true};
    this.notify();
  }
  acknowledge() {
    if (this.pending?.busy) throw new Error("写入仍在进行中，请等待结果。");
    this.pending = null; this.notify();
  }
}
export const writeSafety = new WriteSafety();
