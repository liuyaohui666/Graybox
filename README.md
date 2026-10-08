# Graybox · 本地 M1

研发实验记录桌面应用。当前交付是 **本机开发版**：Windows Tauri + React、Fastify API、PostgreSQL、共用 API 的 CLI/MCP。Supabase、远程协作、正式登录与发布安装包尚未完成。

## 当前电脑运行

在仓库根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1
```

启动器检查已有独立 PostgreSQL 集群，核对持久 environment UUID，按需启动回环 API，再打开已构建的桌面。`-ServicesOnly` 仅启动后台，供 CLI/MCP 使用。`scripts/stop-local.ps1` 只停止该启动器创建且 PID/启动时间/可执行文件匹配的 API；数据库留存，不删数据。

已配置的隔离数据库位于仓库外 `../work/postgres/data`，端口 **55439**，使用已安装的 PostgreSQL 18 二进制。没有修改原有系统数据库服务。API 仅监听 `127.0.0.1:4318`，网页开发服务为 `127.0.0.1:4317`。

本地桌面固定使用现有凭据文件中的第一个人类账号，侧栏只显示自己的头像与昵称；点击头像可更换或恢复默认头像。保留的三个人类账号与独立 Agent 凭据用于隔离测试，不提供日常身份切换入口。`.env`、`.local/credentials.json`、个人客户端映射不进 Git。不要将这些文件放进分享包。此本机开发版没有云同步、离线写入队列或远程访问入口。

## 可用流程

1. 建立项目，在项目下按实验方向记录一次尝试。
2. 保存目标、总结、修改说明；追加实际执行的技术证据。
3. 提交待验收，在首页查看固定提交快照。继续实验后可再提交；旧快照仍保存。
4. 在活动中查看身份、变更前后内容，预览并执行符合条件的批次撤销。

撤销是服务端原子补偿：有后续或交错写入、外部依赖、超期、权限变化等情况会拒绝。创建撤销为软删除；审计和原始证据保留。补偿批次暂不支持自动再撤销。技术证据是提交者报告，不能替代人类评分或真实游戏测试；M1 尚未提供人工评分界面。

CLI、工程绑定和 MCP 使用说明见 `docs/architecture/clients.md`；API 契约见 `docs/architecture/api-contract.md`。本地服务与桌面独立，关闭桌面后代理仍能访问 API。

## 开发和验证

依赖版本由 `pnpm-lock.yaml` 与 `Cargo.lock` 固定。本次使用 Node 24、pnpm 11、PostgreSQL 18、Rust stable/MSVC、WebView2。

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build:web
pnpm run dev:web
```

集成测试会重置 **graybox_test** 的 Graybox schema；只使用专用测试库，禁止指向开发/正式库。Vitest 文件间串行，避免两个集成套件互相重置。不要同时从两个终端运行数据库集成测试。

本机 Rust 安装位于 `../work/toolchains`，没有修改全局 PATH：

```powershell
$env:RUSTUP_HOME = (Resolve-Path ../work/toolchains/rustup).Path
$env:CARGO_HOME = (Resolve-Path ../work/toolchains/cargo).Path
$env:PATH = "$env:CARGO_HOME/bin;$env:PATH"
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
# 下项需要已运行的真实本地 API：
$env:GRAYBOX_CREDENTIALS_PATH = (Resolve-Path .local/credentials.json).Path
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --include-ignored
pnpm run build:web
pnpm exec tauri build --debug --no-bundle --config apps/desktop/src-tauri/tauri.conf.json
```

桌面测试分层：纯展示/重试规则、真实 API 原生桥接、相同 React 界面的浏览器操作、原生进程启动。浏览器验证不等于 WebView2 的逐项点击验收；后续云认证也需要单独验收。

## 在另一台开发电脑准备数据库

源码包不包含数据库、密码、Node 依赖、Rust 工具链或 WebView2。当前一键启动器是本机开发入口，不能当作可搬运安装包。

先准备一个独立 PostgreSQL 18 集群：回环监听、scram-sha-256 密码认证。创建具有迁移权限的 `graybox_admin`、无超级用户/建库/建角色权限的 `graybox_runtime`，以及由管理员拥有的 `graybox_dev` / `graybox_test`。为两账号生成不同随机密码；不要使用示例占位密码。

复制 `.env.example` 为 `.env`，填入该专用集群连接串，然后运行：

```powershell
pnpm exec tsx packages/db/src/migrate.ts
pnpm exec tsx packages/db/src/seed.ts
pnpm exec tsx scripts/prepare-local-runtime.ts
pnpm run api
```

迁移按固定 runtime 角色名授权。种子脚本重跑保留已有记录和凭据，不重置数据库。启动脚本默认本机 PostgreSQL 路径和隔离数据目录；迁移到其他路径需要明确修改该配置。备份至少包含数据库一致性备份与单独安全保存的本地凭据；目前没有完成正式备份恢复演练。

## 后续边界

本次用户明确选择先完成本地开发验证。已用真实 Codex CLI 临时加载本地 MCP，完成查询上下文、创建实验、追加证据、提交快照与审计核验，没有修改全局 Codex 设置。真实 Supabase 登录/Agent 配对、邀请、三人跨机器协作仍需后续联调；媒体、人工评价、Knowledge/中文搜索、自动恢复与正式安装升级属于后续里程碑。不能把本机演示模式部署到公网。


## 项目经验库客户端与 Skill

`node scripts/build-client.mjs` 生成 `.local/client-release`，仅包含独立 CLI/MCP bundle、专用 Skill、中文安装/配对/项目绑定说明和 MCP 配置示例，无个人凭据与 node_modules。需要 Node.js 24；分享时压缩整个生成目录。入口：`node runtime/client.mjs help`；MCP：`node runtime/client.mjs mcp serve`。每位成员使用自己的人类账号批准独立 Agent 配对，外部个人配置使用绝对路径，并为实际项目绑定 UUID。

CLI 新增 `retrospective create|list`、`comment create|list`、`tag list [--q TEXT]`；全部显式 `--cwd ABS`。写入使用 exact shared command envelope，当前项目 `expected_revision` 和稳定 UUID 键，详见 [复盘格式](skills/graybox/references/project-retrospective.md) 与 [中文安装说明](skills/graybox/references/setup.md)。MCP 暴露对应五个工具。报告与评论不可编辑或撤销，通过新报告/纠正评论补充。

## 项目权限与团队账号管理（0.3.0）

账号固定，角色随项目变化：项目创建者是该项目的 owner，其他团队账号是 member。项目详情显示项目 owner 与当前账号的实际项目角色；同一个人可以在自己的项目中是 owner，在别人的项目中是 member。owner 可编辑项目、记录实验/证据、提交验收和添加经验报告；所有团队成员可阅读与评论。Agent 继承其人类账号的项目权限，并同时受凭据项目范围约束。

团队管理只负责邀请、停用等账号管理，不授予编辑其他人项目的能力。历史创建者未知的项目保持未分配、只读，不自动归属团队管理账号。当前不提供转移项目 owner 的功能。每种领域写入与撤销预览/执行都检查当前项目归属；已成功的原始幂等收据仍可按原请求重试，读取项目时重新计算当前角色。旧活动、创建者和历史内容保持原样。

## 成员主页、赞同与消息（0.3.0）

首页与项目空间显示团队成员头像及昵称。点击查看公开资料卡，再点“进入主页”查看该成员创建的想法与主导项目；从主页可进入实际项目详情。资料不显示用户名、凭据或团队管理权限。

人类成员可以赞同其他人的项目/想法，点击“已赞同”可取消；每人只计一次。自己的项目无需赞同，Agent 不能代替人表达赞同。第一次赞同与他人的评论发送站内消息给项目 owner，Agent 评论保留人类与 Agent 归属。取消后保留历史消息，重新赞同不重复提醒；自己的评论不提醒自己。

顶栏“消息”入口在窄屏也可访问，显示完整未读数。消息箱支持逐条已读、将当前显示消息标为已读、加载更早消息与查看项目。只属于当前人类账号；Agent 无法读取。被移入回收状态的项目保留历史消息，明确标示项目不可访问。新到消息不会被当前已读操作误标。每 15 秒及窗口聚焦刷新，失败时可重新读取；不确定写入使用原目标重试并保留导航保护。

升级须通过 `migrate(pool)` / `packages/db/src/migrate.ts` 或审核过的云升级器应用 `001..005`；`005_team_social.sql` 为新增空表与索引/权限，不改写既有账号、项目或讨论，也不为旧互动生成消息。`build-cloud.mjs`、初始安装器、通用迁移器及升级器排序检查包含该迁移。应用与 CLI/MCP/Skill 发布元数据为 0.3.0。

自动化验证涵盖真实隔离 PostgreSQL 人类/Agent 权限、事务回滚、持久去重/已读、云端真实测试账号与分页，以及 UI 展示/重试/桥接规则。真实本地/云端浏览器点击、原生交互与朋友设备验收按交付记录分别确认；构建通过本身不代表这些验收完成。
