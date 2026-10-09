export function navigationBlocked(busy:boolean, synchronousBusy:boolean, pending:unknown) {return busy || synchronousBusy || !!pending;}
export class DraftWriteAttempt {
  private saved: {type:string;payload:object;revision:number}|null=null;
  prepare(type:string,payload:object,revision:number,pending:boolean) {
    if(pending) {
      if(!this.saved || this.saved.type!==type) throw new Error('请先重试原操作或核对记录后解除标记。');
      return this.saved;
    }
    return this.saved={type,payload:structuredClone(payload),revision};
  }
  finish(unresolved:boolean) {if(!unresolved)this.saved=null;}
}
