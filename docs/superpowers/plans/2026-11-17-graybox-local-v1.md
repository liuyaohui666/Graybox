# Graybox 本地个人版 v1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 交付一个可长期使用的 Graybox 本地个人版 v1。

**Architecture:** Tauri 桌面壳 + SQLite 本地数据层 + 本地附件仓库 + 本机 Codex Skill。旧团队版只作为导入来源和 GitHub 参考，不进入运行时。

**Tech Stack:** Tauri 2、Rust、rusqlite、React 19、TypeScript、Node.js 24、Vitest。

## Tasks

### 1. SQLite 完整领域模型

- 将项目、想法、实验、报告、标签、活动、附件、头像、学习方向、学习分支和知识点统一纳入 SQLite。
- 为每张业务表加入 UUID、版本、创建时间和更新时间。
- 测试外键、事务、重启持久化和 D 盘默认路径。

### 2. 本地 Tauri 服务层

- 移除启动时 PostgreSQL、登录和云端配置要求。
- 提供本地 CRUD 命令：项目、想法、实验、学习方向、学习分支、知识点、标签、附件和迁移。
- 所有命令执行后读回核对。

### 3. v1 工作台界面

- 删除团队成员、消息、登录、邀请和云端状态入口。
- 保留项目、想法、实验导航，新增学习和数据管理。
- 完成项目、想法、实验和学习的真实创建、编辑、筛选、搜索和详情页。
- 统一附件预览、头像、历史和五分类报告布局。

### 4. 数据迁移

- 实现 `.graybox` 导出、导入、清单、SHA-256、替换、合并和冲突界面。
- 实现旧云端数据一次性脱敏导入，保留 UUID、时间、来源、附件和历史。
- 在临时目录执行 round-trip 测试。

### 5. Codex 本地 Skill

- 移除云端配对和账号要求。
- 改为发现 `D:\\Graybox`，支持本地读写、补录、导入和导出。
- 用稳定请求键避免重复记录，补齐旧项目同步规则。

### 6. 桌面打包和验收

- 生成本地 v1 exe、无命令窗口启动器和桌面快捷方式。
- 验证断网启动、重启持久化、学习模块、附件和迁移包。
- 保留 GitHub 团队版源码和历史发布物，不再把团队版放入桌面入口。
