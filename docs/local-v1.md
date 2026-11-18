# Graybox 本地个人版 v1

## 启动

桌面快捷方式为 `C:\Users\27223\Desktop\Graybox 本地开发版.lnk`。它启动 `D:\Graybox\Start-Graybox-local-dev.vbs`，本地 API 只监听 `127.0.0.1:4318`，不会连接团队服务器。

## 数据

SQLite 和附件目录位于 `D:\Graybox`。桌面端可以在左下角头像菜单修改昵称、头像，使用“导出数据”“校验迁移包”“导入数据”迁移整套数据。导入完成后重启程序，再点击“刷新”。

## 记录

- 项目支持说明、状态、标签和附件。
- 想法可以独立存在，也可以关联项目。
- 实验必须关联项目，支持目标、进度、标签和附件。
- 学习模块支持学习方向、分支和知识点。
- 活动记录保留本地写入时间。

Codex 写入时可在仓库根目录运行 `node scripts/local-graybox.mjs list`，使用 `record --input <绝对 JSON 路径>` 创建记录，使用 `update --type <project|idea|experiment> --input <绝对 JSON 路径>` 更新记录。先核对工作目录、提交、测试和已有记录，再写入可证实内容。
