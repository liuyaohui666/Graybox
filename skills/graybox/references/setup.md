# 分享包安装与配对

解压整个 Graybox 客户端包到固定目录。需要 Node.js 24；无需 pnpm/node_modules。运行 `node C:/工具/Graybox/runtime/client.mjs help`。

将 skills/graybox 整个文件夹复制到自己选择的项目 `.agents/skills/graybox`；若明确希望所有项目可用，再自行复制到个人 `.codex/skills/graybox`。客户端不会安装或修改全局 Codex 设置。复制后重启相应 Codex 会话。

每位朋友用自己的 Graybox 人类账号批准自己的 Agent 配对，不能共享配对后的凭据。个人配置必须放在 Git 仓库外，例如 C:/Users/你的用户名/Graybox-private/client.json。先执行：

```powershell
node C:/工具/Graybox/runtime/client.mjs auth pair-start --endpoint https://你的服务域名 --name 我的Codex --config C:/Users/我/Graybox-private/client.json
```

在 Graybox 桌面端登录自己的账号，点击左下角头像 → “团队管理” → “Codex 配对”并输入返回的配对码。当前界面会授权全部项目；确认这是你希望授予该 Agent 的范围后批准配对。然后执行：

```powershell
node C:/工具/Graybox/runtime/client.mjs auth pair-complete --config C:/Users/我/Graybox-private/client.json
$env:GRAYBOX_CLIENT_CONFIG='C:/Users/我/Graybox-private/client.json'
node C:/工具/Graybox/runtime/client.mjs auth status
```

配对输出和个人 JSON 是私人文件，不打包、提交 Git 或转发。失效或撤销后重新配对；`--replace` 仅在明确替换已有配置时使用。配对结束后 auth status 给出 environment UUID；workspace/project UUID 从实际项目读取，不猜测。分享包提供只读入口 `node runtime/list-projects.mjs`，在设置 GRAYBOX_CLIENT_CONFIG 后读取可访问项目及其真实 UUID；先让用户选择目标再绑定。

为实际工作目录写 binding.json：
```json
{"version":1,"environment_id":"实际环境UUID","workspace_id":"实际团队UUID","project_id":"实际项目UUID"}
```
```powershell
node C:/工具/Graybox/runtime/client.mjs project bind --cwd C:/我的项目 --input C:/临时/binding.json
node C:/工具/Graybox/runtime/client.mjs context --cwd C:/我的项目
```

绑定只包含 UUID；个人 endpoint 和凭据永远来自外部个人配置。项目目录必须存在，已有不同绑定需要明确 `--replace`。报告/评论输入格式见 project-retrospective.md；执行 `retrospective create --cwd ... --input ...`，读取用 `retrospective list`、`comment list`、`tag list --q 关键词`。所有项目命令显式提供绝对 cwd。

如需 MCP，将包中 config.toml.example 的绝对路径替换后，合并到用户明确选择的项目配置 `.codex/config.toml`。先保留其他已有配置；此示例不授权编辑全局设置。args 必须为 runtime/client.mjs、mcp、serve。MCP 仍为每次工具调用传显式 cwd，配对不替代项目绑定。

账号角色与业务权限分开：创建者为项目 owner，其他人为 member；团队管理不能编辑别人的项目。项目 owner 可编辑项目元数据与添加复盘；想法和实验有独立主导者，编辑内容、证据、提交与合并遵循实体主导权限。成员可参与、评论及创建自己的分支，人工验收由人类完成。Agent 权限等于所属人类的实际业务权限与凭据范围的交集。创建者未知的历史项目未分配、只读。撤销还检查当前项目归属，已成功的原请求原键仅返回稳定收据。

协作命令、独立想法和持久增量同步的完整格式见 [sync.md](sync.md)。自然语言“写入 Graybox / 同步这次结果”使用 sync_status → sync_prepare → sync_execute，先持久保存稳定键，再核对服务器活动推进 checkpoint。
