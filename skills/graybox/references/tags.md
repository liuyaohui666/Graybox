# 记录原生标签

支持范围：项目、独立或关联项目的想法、实验各自的 tags 是字符串数组，标签可多选、搜索已有名称，也可直接新增名称。服务器自动建立团队标签目录并归一化空格和大小写。每条记录最多 30 个标签，每个标签 1–100 字符。

1. 明确实际项目绝对 cwd，读取 context 以及目标 project get / idea get / experiment get，核对目标、can_edit 和最新 revision。sync 日志跟随当前选中的实体：若 active_idea / active_experiment 存在，先处理该目标的 pending 操作，按目标选择 idea activate / experiment activate；项目标签操作才清除选择（idea clear / experiment clear）。
2. `tag list --cwd ABS [--q TEXT]` 或 MCP `tag_list({cwd,q})` 查询已存在标签，优先复用规范名称。
3. 合并目标记录已有 tags 和用户要求新增的名称；只删除明确要求删除的名称。tags 是完整替换集合，不能只传新增名称。新名称无需额外创建标签接口。不同记录的标签分别保存，共用目录，不自动继承关联项目标签。
4. 通过 sync_prepare → sync_execute 发送下列命令，使用稳定操作 UUID、批次 UUID 与幂等 UUID；读取核对后再报告成功。实际命令格式见 sync.md。

```json
{"type":"project_update","idempotency_key":"实际稳定UUID","batch_id":"实际批次UUID","expected_revision":1,"payload":{"id":"实际项目UUID","tags":["保留的已有标签","新增标签"]}}
```

MCP project_write 同样接受上述信封并增加 cwd。CLI `project update --cwd ABS --input command.json` 也可写入，但自然语言增量同步优先持久化同步流程。

想法用 idea_update，实验用 experiment_update，信封结构相同。MCP 可用 command_execute 或 sync_prepare/sync_execute；CLI 对应 idea update / experiment update。

写后调用对应 get/entity_get 核对 tags，再调用 tag list 核对目录。没有权限、REVISION_CONFLICT 或旧客户端拒绝 tags 时保留错误证据；读取最新数据或检查客户端版本。不要根据工具名缺少 tag_create 就声明“接口不支持原生标签”，不要用正文、复盘或评论伪造标签。
