# Flowhome v2 实施范围与可复用验收门

状态：供主代理整合、QA 和版本登记使用。此文档描述当前研究型 MVP 的边界，不替代独立审阅。

## 一、模块到代码与证据的映射

|工作包|当前实现入口|拥有/输出|验收证据|本轮可接受的主张|本轮不能声称|
|---|---|---|---|---|---|
|C0 公共契约|`docs/architecture/v2-contracts.md`、`workflow/v2.json`|单位、事件语义、读写边界、角色表面|C0 已有独立审阅 JSON|架构契约已设计并静态校验|运行时天然满足契约|
|D1 城市数据|`lib/flowhome-v2/engine/world-v2.mjs`、`city-v2.mjs`|命名随机流、持续需求、退出情景、城市快照|引擎回归 F06/F07；运行工件|合成城市可复现，正常/压力情景持续流入|代表上海真实需求分布|
|A1 算法|`observed-v2.mjs`|公开快照校验、规则预测、可行候选、排序建议|F01/F02/F06、未来字段拒绝|先筛可行再排序，预测只读公开信息|训练过的 AI、真实转售价预测|
|L1 承诺与账务|`domain/domain.mjs`、`ledger.mjs`、`policy.mjs`|命令、事件、合同快照、留存和角色账|领域 18 项测试；单件现金桥|模拟状态机支持幂等、版本检查、失败原子性与合同冻结|真实支付、会计准则财报、并发数据库事务|
|S1 履约|`domain/fulfillment.mjs`、`domain.mjs`|检测/配送任务、接受、拒绝、重排、完成报告|拒单不撤销承诺、重复报告去重、失败阻止转售|单案例任务链和责任可追溯|容量发布/预留/消耗、真实排班与服务商接入|
|G1 治理|`policy.mjs`、`domain.mjs`|政策版本、申诉、回避|合同不追改；被申诉者不能自审|治理规则对状态变化有最小可执行影响|组织授权、成员投票、法律实体与现实参与机制|
|U1 五入口|`app/page.tsx`、`app/(workspaces)/*`、`components/flowhome-v2/*`|项目、居民/接手者、运营、服务商、研究界面|浏览器主路径与移动检查|五入口围绕一个本地案例操作|生产账户、多人实时协作|
|I1 集成|`components/flowhome-v2/context.tsx`、领域模块、Worker|统一案例状态、命令边界、角色投影、研究隔离|完整净水器案例；取消/拒单/异常路径；构建|可操作研究原型|真实服务已可履约|
|E1a 实验设计|`experiment-v2.mjs`、`docs/versions/v2-plan.md`|四组策略、共同种子、窗口、配对指标|配置差异、责任对、解释限制|同责任对比能隔离预测开关|因果效应已在现实成立|
|E1b 实验运行|`public/downloads/v2/experiment.json`|120 次运行、逐种子结果、汇总、配对差|run artifact、common seeds、config diff|在当前合成假设下报告方向与区间|市场置信区间、稳定商业收益|
|P1 证据与发布|项目页、下载说明、版本记录|对外主张、复现入口、限制、部署版本|QA 总评、commit SHA、Site version/状态|公开可审查的研究型 MVP|真实商业服务、全面社会效果|

## 二、模块接口边界

### 服务案例内核

- `createCase(config)`：创建不可变模拟案例。
- `dispatch(state, command)`：唯一业务写入口，返回 `{ok,state,result,error?}`。命令必须包含唯一 id、actor role/id；可带 expectedVersion。
- `project(state, role, actorId?)`：按角色提供界面投影。它是原型级字段收敛，不能替代服务端授权。
- 事务性质：每条命令在内存中复制后提交；失败返回原状态；幂等重放返回调用时的当前 state 与首次 result，避免旧状态回滚。

### 城市计算内核

- `runCity(config)`：运行 104 周合成城市，输出 summary、snapshots、groups、forecastEvaluation、events、metadata。
- `runExperiment(config,onProgress?)`：按共同种子运行四组配对实验，输出 runs、aggregates、pairedDifferences 和可复现元数据。
- 算法入口只接受 ObservedSnapshot；隐藏 world 只供结果生成与评估读取。
- 建议输出不写合同、账本、库存或规则；界面不能绕过 `dispatch` 直接改领域状态。

## 三、可复用门禁

|门|进入条件|必须检查|通过后解锁|失败处理|
|---|---|---|---|---|
|G0 契约门|目标、单位、角色、模块写权已冻结|字段语义、读写表、反证条件|并行模块实现|修改契约版本，通知全部下游|
|G1 模块门|owner 交付代码/设计与复现命令|最小反例、幂等/原子性、观察隔离、责任保留|进入集成候选|退回 owner，保留失败原因|
|G2 采用门|主代理已逐文件接入|导出接口、浏览器/Node 兼容、无越权写入|仓库最终文件成为审阅对象|拒绝直接采用交接结论|
|G3 集成门|依赖模块可运行|同一案例、角色投影、取消、拒单、失败、资金桥|实验和界面 QA|缩小范围或修复，不能用 mock 代替|
|G4 实验门|预注册与真实模块就绪|共同种子、唯一组差异、持续流入、窗口/分母、负结果保留|效果类页面主张|标 inconclusive，不继续调参求正值|
|G5 独立审阅门|最终文件与证据稳定|reviewer 独立复跑、hash、claims/limits 一致|accepted 状态登记|revise/reject/inconclusive 原样登记|
|G6 发布门|构建和主路径通过，版本可回退|v1 路径、移动阅读、下载工件、无生产能力误导|提交、推送、Site 版本与部署|修复后重新走 G5/G6|

## 四、任务状态的诚实登记

`accepted` 表示“按该任务写明的验收范围且在该组最终文件上通过独立审阅”。它不等于生产就绪。限制较大的原型可以 accepted，但必须先把 acceptance 改成它确实做到的范围，并且这次范围变更本身进入 reviewer 的 input hash。

对本轮两项最容易过度宣称的工作建议如下：

- **S1**：当前只可验收任务状态、拒单重排、报告去重、费用/责任追踪。原条目中的容量发布、已留存窗口、实际消耗尚未由单案例实现。若不改验收，则 S1 保持 `inconclusive`；未来新增 S2 完成容量账。
- **G1**：当前只可验收政策版本、合同冻结、申诉和利益冲突拒绝。成员资格、授权、投票、真实组织执行尚未实现。可将其命名为“治理最小执行原型”，未来新增 G2 完成组织治理。

这样处理不会否定 MVP；它让项目页能够准确说出“已经验证了什么”和“下一步投资什么”。

## 五、审阅工件规则

1. reviewer 必须检查仓库最终路径，不能只检查子 agent 的外部交接目录。
2. 每个任务单独生成 review JSON；不得复制总评、补写 reviewer 未给出的 accept。
3. `inputHashes` 至少覆盖该任务的实现输出、对应测试/运行工件和本范围文档。
4. E1b 的 `evidenceItems` 至少登记：
   - `run_artifact` → 完整实验 JSON；
   - `common_seeds` → 能看到 101–110 的版本化配置或报告；
   - `config_diff` → 明确 A/B、C/D 唯一改变为 prediction 的文档或工件。
5. QA 总评可以作为 P1 证据，但不能代替每个任务的 taskId 裁决。
6. 任一输出修改后，旧 hash 失效；重跑相应审阅。只改文案也要判断是否改变主张或范围。

## 六、发布时的措辞约束

可以使用：

- “研究型 MVP”“合成城市”“模拟服务”“规则预测基线”“共同种子配对实验”“浏览器本地案例”。
- “在当前假设下，预测排序带来的配对差为……，部分区间可能跨 0。”
- “服务商拒单不自动解除居民承诺；原型记录重排责任。”

避免使用：

- “AI 已预测上海需求”“保证更便宜/更快周转”“已实现真实回购”。
- “平台已有完整信用体系、支付、身份权限、服务商运力或共同治理”。
- 把城市模型结余叫成标准利润，或把模拟区间叫成现实市场置信度。

## 七、下一轮可直接复用的任务包模板

```json
{
  "id": "MODULE-N",
  "owner": "named-agent",
  "reviewer": "different-named-agent",
  "status": "queued",
  "dependsOn": ["accepted-task"],
  "contractVersion": "0.1",
  "inputRefs": ["versioned-input"],
  "outputs": [],
  "acceptance": ["可运行、可证伪的行为"],
  "falsifier": "出现何种结果必须退回",
  "maxRevisions": 2,
  "evidenceRefs": [],
  "reviewEvidenceRefs": [],
  "reviewDecision": "pending",
  "limits": ["当前范围外能力"],
  "evidenceItems": []
}
```

交接包固定包含：主张、输入版本/配置/种子、输出、证据、假设、限制、复现命令、下一动作。研究结果为零或负仍可通过科学性验收；任务超出两轮修订时拆分为更小问题，并登记 blocked/inconclusive。

本轮采用单独的 release-v2.json 范围清单，保留原 v2.json 完整路线，不通过改写原验收抹去未完成能力。
