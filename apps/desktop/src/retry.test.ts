import { expect, it } from "vitest";
import { CommandRetry } from "./retry.ts";
it("a different action cannot replace the retry envelope of an unresolved write",()=>{
 const retry=new CommandRetry();const first=retry.prepare("human","evidence_append",{id:"experiment",summary:"first"},1);
 expect(()=>retry.prepare("human","evidence_append",{id:"experiment",summary:"different"},1)).toThrow("未确认");
 expect(retry.prepare("human","evidence_append",{id:"experiment",summary:"first"},2)).toEqual(first);
 retry.clear();expect(retry.prepare("human","evidence_append",{id:"experiment",summary:"different"},2).idempotency_key).not.toBe(first.idempotency_key);
});
