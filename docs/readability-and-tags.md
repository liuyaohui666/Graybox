# 2026-10-09 文字可读性与原生项目标签

用户选择 A：记录正文 16px，辅助信息不小于 14px，提高深色界面的正文和辅助文字对比度。应用到项目描述、记录列表、详情、讨论、修改历史、表单和附件；保留窄屏导航文字隐藏规则。

云端样式已替换，并备份原 index.html 和 CSS 到 /var/backups/graybox/typography-20261009T155505Z。新 CSS：assets/index-readable-a-23c05505fce3.css，公网返回内容与本地构建逐字节一致。没有修改数据库或重启业务服务。

标签排查：服务器和 CLI/MCP 已支持项目 tags。增加明确工具描述与 Skill 的 tags.md 入口，解释标签目录查询、原生字段、完整集合替换、权限、revision、稳定键、读取核对及活动实体切换。想法和实验尚无独立原生 tags 字段。

验证：类型检查、云端构建通过；客户端集成 14 项通过（包含 CLI/MCP 标签新增、目录查询、保留旧关联与幂等重试）；UI 10 项通过。现有配对 CLI 在专用云端联调项目 d1ea30ea-6df8-4dce-bdad-7b38cacb7fc2 写入“原生标签联调”，sync_execute 状态 verified；项目与标签目录读回核对通过。未改其他实际项目标签。

真实浏览器加载实际组件与本地隔离测试 API：详情正文 computed font-size 为 16px、rgb(241,245,249)，标签和活动时间为 14px，无文档横向溢出。截图 .local/typography-preview/applied-a.jpg 使用测试数据，不代表真实云端账号交互或原生窗口验收。

本机全局 Skill 与随附 CLI 已更新；朋友已下载的 Skill/客户端和公开 0.5.0 下载包不会自动替换。
