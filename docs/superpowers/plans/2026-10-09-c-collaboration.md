# Graybox C 协作工作台 Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the independent backend, interface and client/Skill tasks; integrate and review each task in this session.

**Goal:** 将用户选定的 C 双栏界面接入真实的独立想法、项目实验、分支合并、团队互动和 Codex 增量补写。

**Architecture:** 保留已有 PostgreSQL、Fastify、React、Tauri、凭据和命令重试机制。通过一项追加迁移及现有命令入口增加协作实体。历史项目、实验、评论、证据和账号保留；旧字段在读取时兼容，不重写历史数据。

**Tech Stack:** Existing React 19 / TypeScript / Fastify / PostgreSQL / Tauri; no new dependencies.

## Global Constraints
- 用户已选定 outputs/Graybox-structure-previews 的 C 布局及深色配色。
- 全团队可见；项目、想法、实验分别有实际主导者。账号管理权限不代替项目权限。
- 想法独立或关联一个项目；实验必须关联项目，独立进度、优先级、结果。
- 续做可加入原路线或另开分支，保留来源版本与作者；合并采纳内容，不删除原分支。
- 主导航仅项目、想法、实验、消息；成员在侧栏，账号功能在左下头像菜单。
- 中文功能文案、明显按钮，无口号、装饰英文、重复工作台入口。
- Skill 在用户说写入/同步 Graybox 时补齐上次成功核对之后的可访问工作；失败不推进 checkpoint，不重复写，不编造。
- 生产升级仅 Graybox；保留其他服务器项目、防火墙、账号、旧业务数据。

## Tasks
- [x] 1. 追加 007 协作迁移；共享契约、授权、独立想法、实验进度/主导者、参与、分支、合并、实体评论/赞同/消息；集成测试。
- [x] 2. 新 C React 工作台和独立样式；项目/想法/实验列表、右侧详情、成员主页、编辑表单、分支/合并/讨论；空/错/加载/重试状态。
- [x] 3. CLI/MCP 读取与写入新实体；持久化同步 checkpoint 与成功读取核对；修改仓库 Skill、配套格式与可分发包。
- [x] 4. 替换应用入口；头像账号菜单接入已有资料/头像/团队/退出功能；历史项目复盘和证据访问。
- [x] 5. 本地隔离测试数据库验证迁移、授权、并发版本与幂等；全测试、类型检查、网页/桌面构建、真实浏览器检查。
- [x] 6. 审查并修复关键问题；生成云升级包，校验备份/旧数据保留后仅更新 Graybox；HTTPS、桌面快捷方式与最终截图验证。

## Data/API coordination
Backend owns packages/contracts, packages/core, db, apps/api and backend integration tests. UI owns new collaboration-workbench.tsx, collaboration.css and frontend tests. Client/Skill owns packages/client, apps/cli, apps/mcp, packages/local-context, skills and corresponding tests. Parent owns main.tsx, cloud-ui/account integration, ops/scripts/build/deployment and final verification. Backend publishes exact command/read shapes before other tasks wire writes. New commands use existing stable batch_id/idempotency_key/session_id and expected_revision on updates.
