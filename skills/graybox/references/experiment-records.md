# 实验记录与开始参与

写入实验进展时优先使用原生 `report`，不要把历程、失败、可复用经验和待定结论挤进 summary。report 适用于 experiment_create / experiment_update，结构为：

```json
{"done":["做了什么、得到什么已验证结果"],"failed":["什么行不通、在什么条件下失败"],"reusable":["可以保留的做法、组件或经验"],"pending":["还需要验证的事项、未确定的判断"],"other":["其他背景、备注或项目特殊内容，可自由补充"]}
```

每项是独立的一条重点，尽量一句话说明事实与条件；各类最多 20 条，每条不超过 1000 字符。无证据用 []，不要把空数组解读为“没有问题”。计划、推测、人类验收未完成的内容归 pending，不自动写入 done。证据仍通过 evidence_append 单独保存，report 不替代实际证据。

前端五个分类一行一个。每条内容显示为独立圆点；主动换行视为下一条，自然折行仍属于同一条。写入时将各行拆成数组条目，不手工添加重复圆点。其他 other 可自由发挥，不确定的判断仍明确注明；读取旧报告没有 other 时按 [] 展示，更新时保留原有分类。

先读取现有 report，补齐上次已核对 checkpoint 之后可以访问的工作；保留已有事实，避免重复。旧 summary / change_summary 保留，不直接丢弃旧文字。不凭不存在的历史生成总结。仅在已核对原文足够支持时，将原文中的明确内容整理为 report。

用户明确说“开始这个想法”时，先读取想法并确定新工作名称，调用 command_execute 或持久同步执行 `entity_start`，payload 为 {"entity_type":"idea","entity_id":"实际UUID","name":"用户确定的项目或实验名称"}，信封包含稳定 idempotency_key、batch_id、expected_revision。独立想法创建普通项目；项目内想法在原项目创建实验。返回 started_kind 为 project 或 experiment，id 是新工作的 ID。来源想法、作者、版本和内容快照保留，原提出者不变。不要仅登记参与代替创建实际工作。

任何有访问权限的成员可从同一想法开始不同尝试。再次执行同一请求必须复用幂等键，避免断线重试重复创建。用户要加入已有尝试时，先定位已创建的项目或实验；实验用 entity_join 参与，不额外创建重复路线。新项目与普通项目一样可以添加想法和实验。名称不明确时，先整理建议名称，再请求用户确定。

读取返回的新项目或实验，核对名称、来源想法、主导者及关联项目，再查看原想法状态后报告成功。不要因为用户仅要求保存记录，就替他主动开始参与。

用户要给他人的想法扩充内容时，用 entity_comment，payload 为 {"entity_type":"idea","entity_id":"实际UUID","body":"补充内容","kind":"extension"}；普通评论 kind 为 comment 或省略。补充与评论显示在该想法正文下方，署名、时间和原内容保留；不得用 idea_update 覆盖他人的正文。调用 collaboration_get 读取 comments，核对 kind、body、author_id 后报告成功。
