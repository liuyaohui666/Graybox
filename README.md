# Graybox

三人团队使用的想法、项目和实验记录工具。当前版本 **0.4.2**，数据保存在云服务器，Windows 客户端支持托盘和保存登录状态。

## 下载与启动

从 [Windows 下载页](https://github.com/liuyaohui666/Graybox/releases/tag/v0.4.2) 下载 `Graybox-0.4.2-Windows.zip`，解压整个文件夹到固定目录，然后双击 `Start-Graybox.vbs`。不要只移动 exe；这个入口不会弹命令窗口。`Start-Graybox.cmd` 仅供排查故障。需要桌面快捷方式时双击 `Create-Desktop-Shortcut.vbs`，之后请保留解压目录。

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
