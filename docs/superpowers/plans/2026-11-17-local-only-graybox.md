# Graybox 本地个人版实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Graybox 改为无需网络的个人 Windows 桌面软件，并提供可校验的 `.graybox` 数据迁移包。

**Architecture:** 保留现有 React/Tauri 前端和领域模型，将 PostgreSQL 本地 API 替换为 SQLite 驱动；桌面端和 CLI 共用 loopback API。认证、团队和云端仅保留为一次性导入来源，不进入运行时路径。

**Tech Stack:** Tauri 2、React 19、Fastify、Node.js 24、SQLite、Rust、TypeScript、Vitest。

## Global Constraints

- 运行时不访问网络，不读取 `GRAYBOX_SERVER_URL`，不启动 PostgreSQL。
- 数据保存在 `%LOCALAPPDATA%/Graybox/`，附件和头像必须随迁移包处理。
- 导入前校验清单和 SHA-256；失败或冲突不得破坏当前数据库。
- 保留现有项目、想法、实验、标签、历史、来源、分支和附件关系。
- 不删除云端数据，不把密码、令牌或会话写入迁移包。

---

### Task 1: 建立本地 SQLite 存储层

**Files:**
- Create: `packages/local-db/src/database.ts`
- Create: `packages/local-db/src/schema.sql`
- Create: `packages/local-db/src/repository.ts`
- Modify: `package.json`
- Test: `tests/unit/local-db.test.ts`

- [ ] 添加 SQLite 驱动和严格的数据库目录初始化函数，默认目录为 `%LOCALAPPDATA%/Graybox`。
- [ ] 将当前项目、想法、实验、标签、评论、活动、附件和头像关系映射到 SQLite 表，启用 `foreign_keys`、WAL 和事务。
- [ ] 提供 `openDatabase(root)`, `migrateDatabase(db)`, `backupDatabase(db,target)` 和基础查询接口。
- [ ] 测试首次创建、重复迁移、事务回滚、外键约束和数据库备份可读。
- [ ] 运行 `pnpm vitest run tests/unit/local-db.test.ts`，确认全部通过。

### Task 2: 抽离本地 API 运行模式

**Files:**
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `packages/client/src/client.ts`
- Create: `apps/api/src/local-main.ts`
- Test: `tests/integration/local-api.test.ts`

- [ ] 为 API 增加 `GRAYBOX_MODE=standalone`，只接受 loopback 请求并使用 SQLite repository。
- [ ] standalone 模式拒绝云端认证、成员、配对和远程 endpoint 路由。
- [ ] 将现有业务 service 的数据库访问改为 repository 接口，保持领域命令和五类报告字段不变。
- [ ] 测试断网条件下项目、想法、实验、标签、评论和附件元数据仍能读写。
- [ ] 测试 standalone API 不创建 PostgreSQL 连接，不读取云端配置。

### Task 3: 桌面端改为本地启动与数据管理

**Files:**
- Modify: `apps/desktop/src-tauri/src/main.rs`
- Create: `apps/desktop/src-tauri/src/local_server.rs`
- Modify: `apps/desktop/src/cloud-ui.tsx`
- Modify: `apps/desktop/src/main.tsx`
- Modify: `apps/desktop/src/avatars.tsx`
- Test: `tests/unit/standalone-ui.test.tsx`

- [ ] Tauri 启动时创建数据目录、启动 loopback API，并将前端请求固定到本地地址。
- [ ] 首次启动直接进入工作台，不出现登录、邀请码、初始化码、云端地址或配对表单。
- [ ] 头像菜单改为昵称、数据管理、打开数据目录和退出程序。
- [ ] 首页移除成员、团队、消息和云端状态，保留项目、想法、实验、标签及五分类报告。
- [ ] 测试首次启动、重启后数据可读、托盘打开和网络不可用时 UI 仍可用。

### Task 4: 导出、导入和迁移包

**Files:**
- Create: `packages/migration/src/archive.ts`
- Create: `packages/migration/src/manifest.ts`
- Create: `apps/desktop/src/data-management.tsx`
- Modify: `apps/desktop/src-tauri/src/main.rs`
- Test: `tests/unit/migration-archive.test.ts`
- Test: `tests/integration/migration-roundtrip.test.ts`

- [ ] 定义 `.graybox` ZIP 清单格式，包含格式版本、数据库哈希、附件清单、头像清单和记录数量。
- [ ] 实现 `exportArchive(dataRoot,target)`，导出 SQLite、附件、头像和清单，不导出凭据。
- [ ] 实现 `validateArchive(path)`，逐项校验路径、大小、哈希和清单版本。
- [ ] 实现 `importArchive(path,dataRoot,{mode:'replace'|'merge'})`；替换前自动备份，合并按 UUID 去重，冲突停止并显示差异。
- [ ] 测试完整导出导入 round-trip、损坏包、路径穿越文件、重复导入和 UUID 冲突保护。

### Task 5: 云端历史一次性导入

**Files:**
- Create: `scripts/export-cloud-data.mjs`
- Create: `scripts/import-cloud-data.mjs`
- Create: `packages/migration/src/cloud-normalizer.ts`
- Test: `tests/integration/cloud-to-local-import.test.ts`

- [ ] 从已授权云端读取项目、想法、实验、标签、活动、头像和附件，生成不含凭据的中间导出目录。
- [ ] 将作者和团队字段转换为本地署名与历史说明，不把远程权限带入本地运行时。
- [ ] 保留原 UUID、时间、来源、版本、报告和附件关联。
- [ ] 导入前显示统计和冲突；导入后按 UUID、数量和附件哈希核对。
- [ ] 测试真实数据之外使用脱敏 fixture，禁止把账号 token 写入文件或日志。

### Task 6: 本地 Codex Skill 和 CLI

**Files:**
- Modify: `apps/cli/src/commands.ts`
- Modify: `packages/local-context/src/binding.ts`
- Modify: `packages/local-context/src/sync.ts`
- Modify: `skills/graybox/SKILL.md`
- Modify: `skills/graybox/references/setup.md`
- Create: `skills/graybox/references/local-mode.md`
- Test: `tests/integration/local-cli.test.ts`

- [ ] 将 CLI 默认 endpoint 改为本机 loopback，移除配对和 `GRAYBOX_CLIENT_CONFIG` 的必需条件。
- [ ] 增加 `data export`、`data import`、`data status` 命令，所有写入保留稳定请求键和读回核对。
- [ ] Skill 明确说明“数据只保存在本机”，并指导 Codex 在项目目录绑定本地 Graybox。
- [ ] 测试 CLI 读取、写入、补记、导出和导入；验证失败重试不会重复创建。

### Task 7: 构建、迁移演练和发布说明

**Files:**
- Modify: `README.md`
- Create: `docs/local-migration-guide.md`
- Modify: `scripts/build-client.mjs`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Test: `tests/integration/standalone-release.test.ts`

- [ ] 构建 standalone 桌面包和本地 Skill 包，发布包不包含云端凭据、邀请信息和旧测试数据。
- [ ] 在临时 Windows 数据目录完成创建、导出、清空、导入、重启和附件预览演练。
- [ ] 更新 README 为个人本地版说明，标明云端团队版是历史版本和数据导入来源。
- [ ] 运行 `pnpm typecheck`、`pnpm test`、`pnpm build:web` 和 Tauri debug build。
- [ ] 保存构建哈希、迁移统计和 round-trip 结果，区分自动化验证与用户验收。
