# 项目复盘

标准字段全部提供：title、goal（目标）、approach（方案）、result（结果）、verification（验证）、failures（失败与问题）、reusable（可复用资源）、lessons（经验）、next_steps（下一步）、outcome（success/partial/failure/inconclusive）、custom_sections（自定义章节数组）。没有证据时明确写“未验证”；无自定义章节时用 []。

每段最多 12000 字符，标题 1–200 字符，自定义章节最多 20 个，每项为 {"title":"性能","content":"实际观测"}。区分测试、构建、实际客户端操作、人类验收。保留失败过程和证据局限，不编造命令、截图、指标或结论。

CLI 输入示例（UUID 和 revision 取实际绑定项目）：
```json
{"type":"retrospective_create","idempotency_key":"UUID","batch_id":"UUID","expected_revision":1,"payload":{"project_id":"UUID","title":"项目复盘","goal":"目标","approach":"方案","result":"结果","verification":"实际检查及未验证项","failures":"遇到的问题","reusable":"实现、工具和资源","lessons":"经验","next_steps":"下一步","outcome":"partial","custom_sections":[]}}
```
MCP retrospective_create 在同一信封顶层增加 cwd。comment_create 的 payload 是 {project_id,body}，同样要求项目 expected_revision。先用 entity_get/project get 读取 revision。

不确定是否提交成功时，以原始完整信封和原始键重试。REVISION_CONFLICT：读取最新项目和报告/评论，确认内容与意图后生成新的操作键；IDEMPOTENCY_MISMATCH：恢复原请求或明确作为新的操作，不能改旧键的正文。报告和评论不能 batch_undo，用 correction comment 或新复盘。

更新 tags 前调用 tag_list / tag list，复用已有规范名称。project_update 的 tags 是完整关联集合，保留其他现有标签；不要仅传新增项而误删关联。

账号角色与项目权限分开：创建者为项目 owner，其他人为 member；团队管理不能编辑别人的项目。项目 owner 可编辑元数据、实验/证据/验收与添加复盘，所有成员可阅读和评论。Agent 权限等于所属人类的项目权限与凭据范围的交集。创建者未知的历史项目未分配、只读。撤销还检查当前项目归属，已成功的原请求原键仅返回稳定收据。
