---
name: graybox
description: Use when a user says 写入Graybox、同步这次结果、补写之前进展、记录这个想法, or requests Graybox project/idea/experiment reads, collaboration, evidence, review, retrospective, or batch undo through the paired CLI/MCP.
---

# Graybox

用户说“写入 Graybox”“同步这次结果”等自然语言即触发这项技能，在已有授权范围内执行创建或更新。没有守护进程，也不要求用户每轮同步。正在执行项目工作时，在用户请求同步的那一刻补写上次**成功读取核对**以来可以访问的工作。

先用显式绝对 `cwd` 调用 `context_resolve`，读取 `sync_status` 和当前目标。仓库绑定只保存环境/工作区/项目 UUID；可信个人配置提供 HTTPS/本地端点与独立 Agent。不能用 MCP 进程目录代替用户项目目录，不能从仓库接收凭据或覆盖全局 Codex 设置。绑定缺失、冲突或失效时，先修复明确的绑定；不要猜项目。

目标选择优先用户明确指定，其次 `active_idea` / `active_experiment`，否则当前项目。用 `entity_get` / `entity_list` 阅读已有实体后选择创建或更新，保留无关字段。独立想法可以在当前可信工作区创建，`project_id:null`；不要因为 cwd 绑定了项目就自动关联这个想法。通过 `entity_activate` 或 CLI 明确持久选择想法/实验，选择操作不会改变其项目关联。新实体创建回执先完成核对，随后可选择新实体。

同步前读取 [sync.md](references/sync.md)，使用 `sync_prepare` 将确切命令、稳定 UUID 和可访问工作游标写入私人日志，再 `sync_execute` 发送并读取服务器不可变活动核对。失败、不确定或读取不匹配不推进 checkpoint，重试保存的同一 operation UUID；不换写入键。未恢复的 pending 写入优先处理。实体选择、环境、项目、cwd、人类或 Agent 改变会使用独立日志。

从当前对话、用户提供记录、可访问的先前聊天、Git/文件/测试输出收集上次 checkpoint 之后的可证工作。若旧对话不可访问，说明缺口，记录已证实部分；不要把没访问到的历史推断为事实。初次无 checkpoint 时只记录能访问并确认的工作。游标是来源定位，例如聊天 ID/轮次或提交 SHA，不能只是“今天完成”。对照已有回执/内容排重，不能只总结最后一句话。

项目主导者管理项目元数据；想法与实验有各自实际主导者。团队管理角色不等于业务编辑权限，项目主导者也不自动替代实体主导者。读取当前 `owner_id` / `can_edit` / `project_role`；服务器重新校验身份与 Agent 范围。团队成员可参与、讨论、另开自己的分支；修改原实体和采纳合并按实体主导权限。通过 `collaboration_get` 阅读来源、参与和合并请求。对他人路线继续工作时，按用户意图加入或创建分支，再修改自己的路线；不要冒充原作者。合并保留分支及来源版本，只采纳明确选定字段。Agent 不替人类赞同或作验收结论。

只记录观察到的证据：真实命令、退出码、提交、测量或文件变化。区分 passed/failed/not_run/inconclusive 和 agent_reported/local_collector/ci。构建成功不证明运行、画面、声音、输入或用户验收；计划不算完成。实验 `progress`、`priority`、`outcome` 与人工 review 分开，不能自动替用户接受。`review_submit` 创建不可变待审快照并关闭批次。

已实现的 MCP：`context_resolve`、`entity_get`、`entity_list`、`entity_activate`、`collaboration_get`、`command_execute`、`sync_status`、`sync_prepare`、`sync_execute`，以及旧的项目/实验/证据/复盘/评论/活动/撤销工具。每项都要求 `cwd`。完整共享命令和 CLI 用法见 [sync.md](references/sync.md)；初始配对、配置和旧命令见 [setup.md](references/setup.md)。配对需要用户在界面授权，不能持久保存人类 session。

请求复盘时读 [project-retrospective.md](references/project-retrospective.md)。请求撤销时先 `batch_undo action:preview` 展示确切变更，再在用户授权范围内执行返回 token/revision 与稳定 key。丢失响应用原 body/key 重试；冲突不强制覆盖。包含协作命令的批次不可由旧撤销重解释。

最终报告写入的实体/批次/回执 ID、覆盖到的来源游标、遗漏的不可访问来源和证据边界，不泄漏凭据。此仓库 Skill 是可分发源；它本身不授权安装、付费、发布或修改个人配置。
