import { expect, it } from "vitest";
import { WriteSafety } from "./write-safety.ts";
it("blocks logout and different writes while a result is ambiguous, then retains it across relogin",()=>{
 const guard=new WriteSafety();const first=guard.begin("human","/v1/commands",{idempotency_key:"stable"},1);expect(guard.snapshot()).not.toBeNull();guard.finish(first,false);expect(()=>guard.begin("human","/v1/commands",{idempotency_key:"other"},1)).toThrow();expect(()=>guard.begin("human","/v1/commands",{idempotency_key:"stable"},2)).toThrow();expect(guard.snapshot()?.ambiguous).toBe(true);guard.acknowledge();expect(guard.snapshot()).toBeNull();
});
it("retries identical writes in the existing session and preserves uncertainty after an auth rejection",()=>{
 const guard=new WriteSafety();const first=guard.begin("human","/v1/commands",{idempotency_key:"stable"},1);guard.finish(first,false);const again=guard.begin("human","/v1/commands",{idempotency_key:"stable"},1);guard.finish(again,false,true);expect(guard.snapshot()?.ambiguous).toBe(true);const last=guard.begin("human","/v1/commands",{idempotency_key:"stable"},1);guard.finish(last,true);expect(guard.snapshot()).toBeNull();
});
it("cannot discard a write that is still in flight",()=>{const guard=new WriteSafety();guard.begin("human","/v1/commands",{},1);expect(()=>guard.acknowledge()).toThrow();});
