# 附件与演示

用户说“写入 Graybox，把截图/视频/网页一起上传”时，先同步可访问且已证实的工作，再上传用户明确指定或本次制作中明确属于目标的文件。业务同步仍覆盖上次成功核对以来的来源，不只覆盖最后一句话。附件回执独立于业务 checkpoint；业务成功而附件失败时，恢复原附件输入，不回滚或重复业务记录。

显式选择 `entity_type: project|idea|experiment` 与 `entity_id`。目标优先用户指定，其次 active idea/experiment，否则当前项目；独立想法保持 `project_id:null`。附件目标必须先读取核对。绝对 `cwd` 只决定可信项目上下文，不代替目标 UUID。

CLI：`attachment upload|link|list --cwd ABS --input attachment.json`。MCP：`attachment_upload`、`attachment_link`、`attachment_list`，均要求 `cwd` 和显式目标。

上传输入：
```json
{"entity_type":"experiment","entity_id":"目标 UUID","path":"C:/项目/outputs/截图.png","caption":"实际运行截图"}
```
链接输入：
```json
{"entity_type":"project","entity_id":"目标 UUID","name":"GitHub 项目","caption":"大项目源码","kind":"repository","url":"https://github.com/owner/repository"}
```
列表输入仅含 `entity_type` 与 `entity_id`。链接 kind 为 `repository|demo_link`，只接受无账号密码的公共 HTTPS 地址。

图片 PNG/JPEG/WebP ≤10 MiB；视频 MP4/WebM ≤50 MiB；HTML ≤5 MiB。静态网页只交付一个自包含 HTML，CSS/JS 内联，图片字体以 data URL 内联，不包含外部资源、ZIP、后端或依赖安装。复杂或过大的项目提供 GitHub 链接。HTML 预览隔离且禁止网络、表单和顶层导航。

只读取明确授权的现有普通文件，不扫描整盘、不上传凭据、配置密钥或无关文件。文件路径必须绝对；目录、符号链接和不允许格式拒绝。描述准确区分生成示意图、真实运行截图、未验收录屏。

可信私人配置及附件日志放仓库外；使用已有配对，不读取人类 session。上传前计算文件 SHA256，以目标、文件名、SHA 和说明生成独立私人持久操作。相同内容及元数据重试自动使用原 UUID；链接同样排重。超时、丢失响应、权限变化或读取核对失败保留 pending，重试相同输入，不改变文件/说明来冒充恢复。成功必须读取远端列表，核对 ID、SHA 及完整元数据。缓存成功也重新检查当前权限。

最终分别报告业务 checkpoint、附件 ID/operation_id 和未成功项。不得把附件成功称为人类验收。
