import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SessionContent } from "./cloud-ui.tsx";
import { WriteSafety } from "./write-safety.ts";
it.each(["local","cloud"] as const)("%s mode shows recovery after an ambiguous write without hiding the workspace",mode=>{
 const guard=new WriteSafety();const attempt=guard.begin("human","/v1/commands",{type:"evidence_append"},1);guard.finish(attempt,false);
 const html=renderToStaticMarkup(<SessionContent mode={mode} pendingWrite={guard.snapshot()}><div>实验记录</div></SessionContent>);
 expect(html).toContain("上次 evidence_append 结果未确认");expect(html).toContain("已核对记录，解除未确认标记");expect(html).toContain("实验记录");
});
it("keeps acknowledgement unavailable while a local write is still in flight",()=>{
 const guard=new WriteSafety();guard.begin("human","/v1/commands",{},1);
 const html=renderToStaticMarkup(<SessionContent mode="local" pendingWrite={guard.snapshot()}><div>实验记录</div></SessionContent>);
 expect(html).toContain("写入正在进行");expect(html).not.toContain("解除未确认标记");
});
