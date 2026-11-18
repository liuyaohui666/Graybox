# Graybox 附件与演示实现计划

用户已确认图片、短视频、静态网页演示和大项目 GitHub 链接。沿用团队可见权限，现有业务数据不改写。

## 架构与接口

- 图片 PNG/JPEG/WebP ≤10 MiB；视频 MP4/WebM ≤50 MiB；静态演示为自包含 HTML ≤5 MiB，Codex 将 CSS/JS/资源内联。GitHub/演示网址只存 HTTPS 链接。拒绝 SVG 和可执行附件。
- 文件放独立持久目录，元数据放新增 008_attachments.sql。默认团队总配额 1 GiB；以可配置数值控制，不消耗数据库 BLOB。无付费对象存储依赖。
- GET /v1/attachments?entity_type=project|idea|experiment&entity_id=UUID 返回 {data:Attachment[]}。
- POST /v1/attachments/upload：application/octet-stream 文件体；x-graybox-metadata 为 base64url(JSON {idempotency_key,entity_type,entity_id,name,caption,kind:image|video|demo,sha256})；返回 {data:Attachment}。同人同 key 同内容重试稳定回执；同 key 不同内容拒绝。
- POST /v1/attachments/link：JSON {idempotency_key,entity_type,entity_id,name,caption,kind:repository|demo_link,url}；返回 {data:Attachment}。
- GET /v1/attachments/:id/content：认证二进制，Content-Type 实际白名单类型，禁止嗅探和 HTML 同源执行，HTML CSP sandbox。
- Attachment: id, entity_type, entity_id, kind, name, caption, mime_type, byte_size, sha256|null, url|null, uploader_id, created_at, target_revision。
- 所有读写重新检查真实凭据和业务目标；上传遵循 can_edit/can_contribute；禁止范围受限 Agent 读取独立想法。内容读取先授权，不用永久公开 URL。
- 桌面原生桥接仅增加明确附件上传/下载命令，不把 token 交给 renderer；浏览器 fetch bearer 获取 Blob。图片/视频使用私有 Blob，HTML 通过 sandbox=allow-scripts 的 authenticated short-lived HTTP preview/CSP 隔离，禁止网络、表单、顶层导航、同源权限。关闭预览清理 Blob。

## 顺序与验收

- [ ] 后端：新附件模块、授权、哈希/格式/配额、原子存储、幂等事务、迁移和真实隔离数据库测试。先权限/重复/格式测试红再绿。
- [ ] 前端与原生：项目/想法/实验详情附件区，选择文件/说明、GitHub链接、预览/视频播放。上传失败保留相同 key，切换对象/账号防止错写。中文按钮与现有深色布局一致。
- [ ] CLI/MCP/Skill：明确绝对 cwd 与文件路径，按 SHA256 持久私人上传收据，读取确认才完成；写入后同步未上传文件，不自动扫整盘。MCP 通过专用工具调用同一实现。
- [ ] 配置部署：专用 /var/lib/graybox/attachments，systemd 只开放此写入路径，Nginx 仅 Graybox vhost 上传大小；升级保护旧服务和数据库，附件独立备份。检查磁盘余量。
- [ ] 端到端：真实上传并读回一张图、一段短视频、一个可点击 HTML、一个 GitHub链接；拒绝陌生/其他权限、路径穿越/类型伪装、超限与重复键。
- [ ] 新云端与 Windows/Agent 发布包，更新 README/Skill 和 GitHub release，真实文件下载校验；朋友设备验收另行保留。
