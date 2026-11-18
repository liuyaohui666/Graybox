---
name: graybox
description: Use when a user says 写入Graybox、同步这次结果、补写之前进展、记录这个想法, or requests Graybox project/idea/experiment reads, collaboration, evidence, review, retrospective, or batch undo through the paired CLI/MCP.
---

# Graybox

## 本地个人版（当前默认）

当用户没有明确要求团队云端操作时，使用本地个人版。数据目录固定为 `D:\\Graybox`，不登录、不联网、不读取团队项目。用户说“写入 Graybox”“同步这次结果”“补写之前进展”时，先读取本次工作目录中的文件、Git 提交、测试输出和已有记录，再把能够核对的内容写入本地 SQLite。优先使用仓库中的 `node scripts/local-graybox.mjs list` 查看现有记录，写入可用 `record --input <绝对 JSON 路径>`，更新可用 `update --type project|idea|experiment --input <绝对 JSON 路径>`。输入中的 `type` 必须明确，项目内实验必须有 `project_id`，独立想法使用 `project_id:null`。不要把推测、未运行的计划或没有证据的结果写入“已完成”。

本地记录按五类整理。项目记录目标、说明、状态和标签，想法可以独立也可以关联项目，实验必须关联项目并记录目标、进度、结果与可复用经验，学习记录使用桌面端“学习”模块的方向、分支和知识点，其他材料放在附件。用户要求截图、视频、网页演示或仓库链接时，在桌面端对应记录的“附件与链接”中添加并重新读取核对。完成一次本地写入后，报告写入的记录 ID 和证据来源。

本地版迁移从左下角头像菜单使用“导出数据”“校验迁移包”“导入数据”。迁移包扩展名为 `.graybox`，不要手动复制 SQLite 的 WAL 文件。导入后重启 Graybox，再刷新列表核对记录。

只有用户明确说“云端”“团队服务器”或“朋友账号”时，才使用下方的团队同步流程，并先确认当前目标确实是云端版本。

实验记录按原生 report 的“做了什么、什么行不通、可复用经验、待定事项、其他”分条填写；用户要求从想法开始新工作时用 entity_start：独立想法建项目，项目内想法建实验；加入已有实验用 entity_join。想法补充用 entity_comment 的 kind:extension，保留原作者和原文。执行前读取 [experiment-records.md](references/experiment-records.md)，保留旧正文与现有内容，核对后报告。

项目、项目内想法、独立想法和实验均支持各自的原生 tags。用户要求添加、删除、整理或搜索标签时，读取 [tags.md](references/tags.md)。通过 tag_list 查询共享目录，通过对应 project_update / idea_update / experiment_update 的 payload.tags 写入；没有 tag_create 工具不代表不支持。不得用正文代替标签，也不自动继承项目标签。

用户要求把截图、视频、静态网页或 GitHub 链接一起写入时，读取 [attachments.md](references/attachments.md)，用显式目标与文件范围调用 `attachment_upload` / `attachment_link`，最后 `attachment_list` 核对。附件回执独立于业务同步 checkpoint，失败保留原输入和稳定键。

用户说“写入 Graybox”“同步这次结果”等自然语言即触发这项技能，在已有授权范围内执行创建或更新。没有守护进程，也不要求用户每轮同步。正在执行项目工作时，在用户请求同步的那一刻补写上次**成功读取核对**以来可以访问的工作。

先用显式绝对 `cwd` 调用 `context_resolve`，读取 `sync_status` 和当前目标。仓库绑定只保存环境/工作区/项目 UUID；可信个人配置提供 HTTPS/本地端点与独立 Agent。不能用 MCP 进程目录代替用户项目目录，不能从仓库接收凭据或覆盖全局 Codex 设置。绑定缺失、冲突或失效时，先修复明确的绑定；不要猜项目。

目标选择优先用户明确指定，其次 `active_idea` / `active_experiment`，否则当前项目。用 `entity_get` / `entity_list` 阅读已有实体后选择创建或更新，保留无关字段。独立想法可以在当前可信工作区创建，`project_id:null`；不要因为 cwd 绑定了项目就自动关联这个想法。通过 `entity_activate` 或 CLI 明确持久选择想法/实验，选择操作不会改变其项目关联。新实体创建回执先完成核对，随后可选择新实体。

同步前读取 [sync.md](references/sync.md)，使用 `sync_prepare` 将确切命令、稳定 UUID 和可访问工作游标写入私人日志，再 `sync_execute` 发送并读取服务器不可变活动核对。失败、不确定或读取不匹配不推进 checkpoint，重试保存的同一 operation UUID；不换写入键。未恢复的 pending 写入优先处理。实体选择、环境、项目、cwd、人类或 Agent 改变会使用独立日志。

从当前对话、用户提供记录、可访问的先前聊天、Git/文件/测试输出收集上次 checkpoint 之后的可证工作。若旧对话不可访问，说明缺口，记录已证实部分；不要把没访问到的历史推断为事实。初次无 checkpoint 时只记录能访问并确认的工作。游标是来源定位，例如聊天 ID/轮次或提交 SHA，不能只是“今天完成”。对照已有回执/内容排重，不能只总结最后一句话。

项目主导者管理项目元数据；想法与实验有各自实际主导者。团队管理角色不等于业务编辑权限，项目主导者也不自动替代实体主导者。读取当前 `owner_id` / `can_edit` / `project_role`；服务器重新校验身份与 Agent 范围。团队成员可参与、讨论、另开自己的分支；修改原实体和采纳合并按实体主导权限。通过 `collaboration_get` 阅读来源、参与和合并请求。对他人路线继续工作时，按用户意图加入或创建分支，再修改自己的路线；不要冒充原作者。合并保留分支及来源版本，只采纳明确选定字段。Agent 不替人类赞同或作验收结论。

只记录观察到的证据：真实命令、退出码、提交、测量或文件变化。区分 passed/failed/not_run/inconclusive 和 agent_reported/local_collector/ci。构建成功不证明运行、画面、声音、输入或用户验收；计划不算完成。实验 `progress`、`outcome` 与人工 review 分开，不能自动替用户接受。`review_submit` 创建不可变待审快照并关闭批次。

已实现的 MCP：`context_resolve`、`entity_get`、`entity_list`、`entity_activate`、`collaboration_get`、`command_execute`、`sync_status`、`sync_prepare`、`sync_execute`，以及旧的项目/实验/证据/复盘/评论/活动/撤销工具。每项都要求 `cwd`。完整共享命令和 CLI 用法见 [sync.md](references/sync.md)；初始配对、配置和旧命令见 [setup.md](references/setup.md)。配对需要用户在界面授权，不能持久保存人类 session。

请求复盘时读 [project-retrospective.md](references/project-retrospective.md)。请求撤销时先 `batch_undo action:preview` 展示确切变更，再在用户授权范围内执行返回 token/revision 与稳定 key。丢失响应用原 body/key 重试；冲突不强制覆盖。包含协作命令的批次不可由旧撤销重解释。

最终报告写入的实体/批次/回执 ID、覆盖到的来源游标、遗漏的不可访问来源和证据边界，不泄漏凭据。此仓库 Skill 是可分发源；它本身不授权安装、付费、发布或修改个人配置。
