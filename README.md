# Graybox

三人团队使用的想法、项目和实验记录工具。当前版本 **0.5.0**，数据保存在云服务器，Windows 客户端支持托盘和保存登录状态。

## 直接发给 Codex

朋友可以把下面整段发到自己电脑的 Codex。Codex 完成下载、检查、全局 Skill 安装和配对准备；账号登录、邀请码注册及网页批准配对由本人完成。不要把密码或配对凭据发到对话里。

```text
请读取 https://github.com/liuyaohui666/Graybox 的最新 README，按“最新版 Skill 的全局安装”帮我接入 Graybox。
下载并校验 README 指定的最新版 Skill 包，检查 Node.js 24，将 Skill 安装到我个人 Codex 技能目录，让所有项目都能使用。保留已有个人修改、私人配置和其他技能，不修改全局 Codex 配置或持久环境变量。
使用我的账号发起独立 Agent 配对，展示配对码和批准步骤，让我在 Graybox 的“头像 → 团队管理 → Codex 配对”中批准；不要索取、输出或共享密码与 Token。已有有效配对时复用，不重复配对。
完成后做只读连通核对，读取真实项目列表。接入时不要默认创建项目或写入测试业务记录。后续我在实际项目对话说“写入 Graybox”时，再按 Skill 选择或创建对应项目、绑定实际目录并同步。
如果新安装的 Skill 需要重开对话才会被识别，明确告诉我，不要声称当前会话已经自动加载。
```

### 最新版 Skill 的全局安装

旧 Windows 发布包中的 Skill 可能落后于云端。Codex 接入请单独下载 [最新版 Skill 与独立客户端](https://github.com/liuyaohui666/Graybox/raw/refs/heads/main/downloads/Graybox-Skill.zip)，支持原生标签和五类实验记录。此包没有账号、邀请码或已配对凭据，也不含桌面程序。

本次发布 ZIP 的 SHA256：`5195d9f3c0c6a1b5f8884290977ced62b8404d30166f643a49718328fdb131df`。下载后校验，不匹配时停止使用并说明原因。

Codex 应按以下顺序执行：

1. 检查 Node.js 24；缺失时说明官方安装步骤，不假装已安装。将 ZIP 解压到仓库外固定目录，检查有 `runtime/client.mjs`、`runtime/list-projects.mjs`、`skills/graybox/SKILL.md` 和 `release.json`。
2. 全局技能目录使用当前设备的 `CODEX_HOME/skills/graybox`；未设置 CODEX_HOME 时使用当前用户的 `.codex/skills/graybox`。安装整个 `skills/graybox`，比较已有文件，保留用户修改和私人配置。把 `runtime/client.mjs` 复制到技能目录的 `scripts/client.mjs`，以后调用此固定路径。不要把仓库私有凭据带进安装包。
3. 在全局 Skill 中添加或更新本机安装说明，记录实际 Node/CLI 路径以及仓库外的个人配置路径，引用该说明供其他项目对话读取。只记录配置路径，不写凭据内容。不同项目复用同一份 Skill 和本人的 Agent 配对，各项目绑定与同步检查点独立。
4. 先运行 `node <实际CLI路径> help`。检查现有个人配置和 `auth status`；已有有效配对直接复用。否则按下方配对步骤操作，服务地址为 `https://api.qingsuworks.top:8443`，每人使用自己的 Graybox 账号批准自己的 Agent。
5. 普通 CLI 调用只在当前进程设置 `GRAYBOX_CLIENT_CONFIG`；首次接入读取账号状态和真实项目列表即可。绑定始终使用实际工作项目的绝对 `--cwd`，不能绑定到下载包目录，也不能默认选择同名项目或安装验证项目。
6. 告知用户重开项目对话以识别新 Skill。无需 MCP 即可使用 CLI；不要为了接入改写全局 `.codex/config.toml`。

全局 Skill 安装是上面这段用户指令的明确授权；旧的项目级安装步骤仅作为可选方案。

### 接入后怎么使用

在任何实际项目对话里说“写入 Graybox”“同步这次结果”或“补写之前进展”。Codex 应读取已有记录和上次成功同步位置，补齐可核实的遗漏；不需要每轮同步。

旧项目首次整理可以直接发：

```text
使用 Graybox skill，把当前项目截至现在的可核实历史重新整理并实际录入。先读取已有 Graybox 记录，优先更新原记录、补齐遗漏和修正描述，不重复创建，不删除有效历史，也不覆盖无关字段。
尚未实施的方案录为想法；实际尝试按阶段录为实验，填写原生标签、进度、优先级和结果。每个实验按“做了什么、什么行不通、可复用经验、待定事项、其他”分点填写，一条一个重点。保留失败、限制与结论变化，区分测试、真实运行和用户验收，不编造无法访问的对话。
主动收集本项目范围内有代表性的截图、运行画面、阶段成果、短视频、静态网页演示和文档，关联到对应阶段并注明用途。附件管理在记录末尾，可预览材料按软件布局展示；大项目填写 GitHub 地址。没有现成截图时，仅对能安全运行的已有成果截取真实画面，不继续开发，不伪造证据，不上传凭据或无关文件。
按 Skill 的稳定请求键、检查点和重试规则执行，完成后读回核对。汇报重整了哪些旧记录、补入哪些材料、覆盖到哪里及无法核实的缺项。不要只返回总结草稿。
```

## 下载与启动

从 [Windows 下载页](https://github.com/liuyaohui666/Graybox/releases/tag/v0.5.0) 下载 `Graybox-0.5.0-Windows.zip`，解压整个文件夹到固定目录，然后双击 `Start-Graybox.vbs`。不要只移动 exe；这个入口不会弹命令窗口。`Start-Graybox.cmd` 仅供排查故障。需要桌面快捷方式时双击 `Create-Desktop-Shortcut.vbs`，之后请保留解压目录。

浏览器也可以打开 [Graybox 云端](https://api.qingsuworks.top:8443/)。日常使用不需要在电脑上运行数据库、API 或云服务器；自己的电脑关机不会影响其他成员。桌面客户端需要 Microsoft Edge WebView2 Runtime；Codex 接入另需 **Node.js 24**。

GitHub 的 **Code → Download ZIP** 下载的是源码，不能替代 Releases 里的可运行客户端。

## 公开下载不等于加入团队

此仓库公开，任何人可以查看源码和下载客户端。**这不会让下载者自动加入现有团队，也不会公开团队项目、想法、评论和实验数据。**

加入现有团队需要管理员私下提供有效邀请码。管理员在左下角头像菜单 → **团队管理** → **生成成员邀请码** 操作；朋友在登录页面使用邀请码，设置自己的用户名、密码和昵称。邀请码仅可使用一次、24 小时失效，当前团队最多三个人类账号。用户名用于登录，昵称用于团队展示。

每位成员使用自己的账号。入组后能看到团队之前和之后的记录；别人更新后点击右上角 **刷新**。项目和想法从录入起对整个团队可见。团队管理权限不代表可以编辑其他成员主导的项目、想法或实验。

发布包不包含邀请码、密码、登录会话或配对后的 Agent 凭据。不要将这些私人内容放进 GitHub、Issue 或聊天截图。

## 当前功能

- 项目、标签、优先级；查看成员资料与主页。
- 独立想法或关联项目的想法，筛选未关联想法。
- 项目下的实验，记录进度、优先级、结果与证据。
- 参与他人的想法或实验、创建自己的分支、提交采纳请求；原主导者决定是否合并，保留来源。
- 评论、赞同、消息、活动记录和项目经验报告。
- Codex 通过专用 Skill 和独立 Agent 读写，支持补记可访问的遗漏进展与原请求重试。

## 让朋友的 Codex 接入

先完成自己的 Graybox 账号登录。然后把以下文字交给 Codex，并替换成自己电脑的实际绝对路径：

> 阅读 `C:/工具/Graybox/README.md`，按其中步骤帮我接入 Graybox。我实际工作的项目目录是 `D:/我的项目`。先检查 Node.js 24 和客户端路径，将 Skill 安装到这个项目的 `.agents/skills/graybox`，保留已有文件；不要修改全局 Codex 配置，不要索取或输出密码、Token。发起我自己的 Agent 配对，让我到 Graybox 的头像菜单中批准；完成后读取真实项目列表，让我选择已有项目或明确新建项目，再绑定实际目录。先做只读核对；业务写入等我说“写入 Graybox”再进行。

下载包包含 `runtime`、`skills` 和配置示例，无需安装 pnpm 或 node_modules。以下是 Codex 应执行的步骤；**占位路径必须先替换**。

### 1. 安装项目级 Skill

检查 `node --version` 为 v24。将整个 `skills/graybox` 复制到实际项目的 `.agents/skills/graybox`；已有不同版本先比较，保留用户自己的修改。复制后重开该项目的 Codex 会话。

只从源码下载时，先在 Graybox 源码目录运行 `pnpm install --frozen-lockfile` 和 `node scripts/build-client.mjs`，客户端生成在 `.local/client-release`。普通用户直接下载 Releases，无需这一步。

### 2. 为自己的 Codex 配对

PowerShell 示例（变量只对当前进程有效，新终端需要重新设置）：

```powershell
$GrayboxDir = 'C:/工具/Graybox'
$GrayboxProject = 'D:/我的项目'
$GrayboxPrivate = Join-Path $env:USERPROFILE 'Graybox-private/client.json'
node "$GrayboxDir/runtime/client.mjs" auth pair-start --endpoint https://api.qingsuworks.top:8443 --name '我的Codex' --config "$GrayboxPrivate"
```

在已登录自己的 Graybox 中点击左下角头像 → **团队管理** → **Codex 配对**，输入命令返回的配对码并批准。配对码约十分钟有效。当前界面授权该 Agent 访问此账号可访问的全部项目，服务端仍检查实际业务编辑权限。

```powershell
node "$GrayboxDir/runtime/client.mjs" auth pair-complete --config "$GrayboxPrivate"
$env:GRAYBOX_CLIENT_CONFIG = $GrayboxPrivate
node "$GrayboxDir/runtime/client.mjs" auth status
node "$GrayboxDir/runtime/list-projects.mjs"
```

返回 `pending` 时先批准再完成领取。配置和 Agent 凭据保存在仓库外的个人目录，不能转发朋友。普通 CLI 命令依赖 `GRAYBOX_CLIENT_CONFIG`，不是 `--config`；Codex 每次新建命令进程都应设置这个环境变量。配对失效或被撤销后重新配对，不能复制他人的凭据。

### 3. 选择并绑定真实项目

`list-projects.mjs` 只读返回实际环境、团队和项目 UUID 与名称。由用户选择目标，不能猜测 UUID，也不能绑定任意同名项目。

将选择的三个真实 UUID 写入临时 `binding.json`：

```json
{"version":1,"environment_id":"实际环境UUID","workspace_id":"实际团队UUID","project_id":"实际项目UUID"}
```

```powershell
node "$GrayboxDir/runtime/client.mjs" project bind --cwd "$GrayboxProject" --input 'C:/临时/binding.json'
node "$GrayboxDir/runtime/client.mjs" context --cwd "$GrayboxProject"
node "$GrayboxDir/runtime/client.mjs" sync status --cwd "$GrayboxProject"
```

目录必须已存在。没有合适项目时，可在 Graybox 新建项目后重读列表；或明确授权 Codex 按共享命令格式新建。已有不同绑定先说明差异，不能擅自 `--replace`。绑定只保存 UUID，不保存端点或凭据。

### 4. 日常写入和补记

说“**写入 Graybox**”“**同步这次结果**”或“**补写之前进展**”即可。Skill 读取目标和上次已核对的同步记录，将之后可访问的工作按格式写入，再读取服务器活动核对。忘记一两次可以补记；无法访问的旧对话不能凭空补全，会明确说明缺口。

写入使用 `sync prepare → sync execute` 保存稳定请求键和回执，失败时重试同一操作，不重复创建。技术测试、实际运行和人工验收分别记录；Codex 不代替人类赞同或宣布验收通过。编辑和采纳遵循项目或想法/实验的实际主导权限。

首次接入默认只读。用户明确请求写入后才记录业务内容。完整规则见 [Skill](skills/graybox/SKILL.md)、[同步与协作格式](skills/graybox/references/sync.md)、[经验报告格式](skills/graybox/references/project-retrospective.md)。

### 5. MCP（可选）

CLI 已能完成上述流程。需要 MCP 时，将 `config.toml.example` 的 Node、客户端和个人配置路径换成实际绝对路径，合并到用户选择的项目 `.codex/config.toml`；保留已有配置，不能擅自改全局设置。MCP 参数为 `runtime/client.mjs`、`mcp`、`serve`，每次工具调用仍传入实际绝对 `cwd`。

## 图片、视频和网页演示

项目、想法、实验的详情里都有 **附件与链接**。可上传 PNG/JPEG/WebP（10 MB 内）、MP4/WebM（50 MB 内）和单个自包含 HTML（5 MB 内），填写说明后，团队成员可以直接查看。大项目填写 GitHub 地址；附件不会随公开源码仓库一起公开。

HTML 的 CSS、JavaScript、图片等资源需内联；不支持 ZIP、外部依赖、网络请求或后端。演示在隔离窗口中运行。团队附件默认总额度为 1 GB，由部署者调整。

也可以对 Codex 说“把这张截图和这段视频写入 Graybox 的这个实验”。它使用自己的配对权限，核对目标，只上传指定文件，并在成功后读取服务器确认。失败重试复用原操作，不重复上传。CLI/MCP 的格式和恢复规则见 [附件说明](skills/graybox/references/attachments.md)。

## 登录与故障

- 关闭桌面窗口后程序留在右下角托盘，从托盘打开工作台；彻底退出用托盘菜单。显式退出登录、账号停用或凭据撤销后需要重新登录。
- 保存提示“结果尚未确认”表示响应或核对失败，不表示确定没有保存；用核对/重试入口，避免重复录入。
- 看不到朋友的新内容先点 **刷新**；失败则检查网络和服务器连接。
- 浏览器与桌面、不同电脑的登录状态分别保存。Agent 配对不能代替人类账号登录。
- 客户端未做代码签名，朋友的真实 Windows 设备兼容性仍需验证；遇到系统提示时先核对发布文件与校验值。

## 开发者

技术栈：Tauri 2 + React、Fastify、PostgreSQL、共享 CLI/MCP；当前云端使用独立自托管服务。普通团队成员不需要部署服务器。部署说明见 [ops/cloud](ops/cloud/README.md)。

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm exec vitest run tests/unit
pnpm run build:web
node scripts/build-client.mjs
```

集成测试会重置专用 `graybox_test` 的 Graybox schema，禁止指向正式库；不同时运行多个数据库测试。配置模板为 `.env.example`，真实 `.env` 和 `.local` 不提交。早期架构文档记录历史设计，当前行为以代码、本文和对应验证说明为准。

已完成独立 Codex 对话中的真实 Skill/Agent 写入、补记、稳定请求重试及 MCP 只读联调。详见 [验证记录](docs/skill-agent-live-check.md) 与 [手动刷新](docs/manual-refresh.md)。朋友设备安装和不同人类账号的完整分支合并仍需实际验收；构建通过不等于这些验收已完成。
