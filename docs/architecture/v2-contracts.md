# v2公共契约草案 0.1

设计审阅版；未在业务引擎中实现。以下接口用于独立研究与mock开发，不代表真实支付、授权或异步基础设施已存在。

## 通用语义

- 钱：`amountMinor`为整数，`currency=CNY`，单位为分；界面转换成元，禁止混用v1的元整数。
- 时间：模拟中使用整数`tick`及显式`clockVersion`；一个tick的实际长度由场景指定。真实服务接入另用带时区时间戳，适配层不可隐式换算。
- 主体/关联：`caseId, assetId, orderId, commitmentId, taskId, runId`。未创建的ID不伪造；模拟ID不得进入真实订单空间。
- 每个对象携带`schemaVersion`；观察、算法、规则、行为、服务适配、指标分别版本化。
- 字段来源标记：observed（已知事实）、calibrated（有校准证据）、assumption（模拟假设）、policy（组织选择）。模拟发生的事件仍是模拟事实，不自动升级为真实observed数据。

## M1 → M2：ObservedSnapshot

字段：`snapshotId, schemaVersion, asOfTick, eventCursor, policyBundleRef, publicInventory, disclosedIntentions, openDemand, observedDemandHistory, providerOffers, commitmentBudgetProjection`。

每条外部信息含`observedAtTick <= asOfTick`、来源和有效期。未来的预计释放时间可以出现，但必须已有公开披露；潜在实际离开/未来取消/未来服务失败不能出现。隐藏世界在另一个输入文件，M2 API不接受它。页面在研究视角展示真值时，也不能把该对象传回建议链。

本轮 fixture 位于`workflow/fixtures/observed.json`和`world.json`，分别表示公开与隐藏数据。校验器只验证若干结构字段及禁止字段，不证明真实运行代码无法间接泄漏信息。

## M2 → M3：Proposal

字段：`proposalId, snapshotId, algorithmVersion, policyBundleRef, expiresAtTick, options[]`。

每个选项含物件/SKU、分项价格、可行窗口、候选保障价、约束依据和不确定性。只有模型真的产出预测分布时才填预测分布；规则点估计必须标明是点估计。`proposedGuaranteeMinor`不等于合同的`guaranteedAmountMinor`。Proposal不可改变库存、合同、现金或预约。

## UI/适配器 → 应用处理器：Command

字段：`commandId, type, actorContext, correlationId, causationId, issuedAtTick, expectedAggregateVersions, payload`。

最小命令：RequestQuote、AcceptOffer、RequestExit、AcceptServiceTask、RecordServiceReport、ConfirmHandover、CancelOrder、SubmitAppeal、ApprovePolicyChange。

AcceptOffer由执行器重新检查报价有效期、用户接受条款、资源与资金；失败返回原因或新建议，不能静默改变已接受价格。应用事务协调器调用M3/M4/M5各自内部处理器，保证合同确认与所需资源留存共同成功或失败。确认一年后的保障可能基于经营能力预算，不得伪称服务商已接受一年后的具体任务。

同一commandId同载荷返回原结果；异载荷拒绝。重复服务报告按sourceId/sourceEventId去重，陈旧聚合版本拒绝写入。上述为实现验收要求，当前未实现。

## 业务处理器 → 模块/投影：DomainEvent

字段：`eventId, type, schemaVersion, aggregateId, aggregateVersion, commandId, correlationId, causationId, occurredAtTick, recordedAtTick, policyBundleRef, payload`。

区分OfferAcceptedRequested与CommitmentConfirmed：用户选择只是请求，后者必须由M3在资源检查/留存成功后产生。M4的ServiceCompleted报告不是付款成功；M5依据合法事件决定入账，M3依据交接事实决定权属变化。只有已发生事实进入事件日志，未来计划是计划对象。

## M6 → 各模块：PolicyBundle

固定ID、内容hash、生效时间，引用保障、定价、服务、共同治理和会计政策。技术算法版本与政策版本分开。新规则不改变旧合同快照；人工例外也要有授权、理由和审计记录。对运营者自身的争议必须回避并转授权治理角色，不允许同一被申诉者自审。

## M7：RunArtifact / EvidenceBundle

运行记录：引擎commit、数据/观察schema、世界fixture、行为模型、算法、政策hash、服务适配器、指标版本、种子及命名随机流、预热/比较/尾期窗口、组间差异、原始结果与复现命令。

证据包：claim、inputs、outputs、evidence、assumptions、limits、reproduce、reviewDecision。实施完成、模拟结果和现实验证必须分别声明。

## 共同回归案例（待实现执行）

F01：便宜物件在tick2才可用，交付还需2 tick，需求截止3；稍贵物件tick0可用，应选择后者。
F02：第一家服务商无容量，第二家可行，应继续搜索。
F03：两个并发接受争用一件物件，最多一次成功。
F04：重复接受/完成回执/取消重试不重复扣款或释放。
F05：确认后政策更新不改原合同；服务商拒单转重排，不取消居民保障。
F06：修改隐藏未来实际离开，先前观察和建议不变。
F07：持续流入与停止需求压力测试分开，尾期责任不消失。
F08：现金、留存、库存成本分别对账；拒绝/失败/取消不隐去应付费用。

## 权限与取消

共享事实不代表共享可见性：居民读自己的选择与账单，服务商读履约所需任务及自身结算，运营者按职责读经营数据，研究者读模拟或经授权去标识数据。项目页仅聚合信息。生产授权在后端执行，不能以隐藏按钮代替。

未接受建议失效不释放不存在的资源；未执行预约取消释放未消耗资源；执行中中止走补偿流程；已交付走退货或新交易。已经支付、完成的劳动或已消耗容量不得通过删除事件恢复成“未发生”。
