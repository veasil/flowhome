# Flowhome v2 独立引擎实施提案

此目录为已集成的研究实现。它是合成模拟，不是付款、授权、真实合同、生产事件存储或访谈校准结果。engineCommit 为 null，避免文件包含自身提交的循环引用；正式报告以顶层 sourceHashes（SHA-256）锁定源文件，包含报告的发布提交锁定整个交付。

## 入口

```js
import { DEFAULT_V2, STRATEGIES_V2, runCity, runExperiment } from './index.mjs';
const city = runCity({ ...DEFAULT_V2, strategy: 'D', seed: 42 });
const report = await runExperiment({}, ({ completed, total }) => console.log(completed, total));
```

浏览器入口 `index.mjs` 及其依赖没有 Node API、包依赖或网络请求。`regression.mjs`、`run-experiment.mjs` 为 Node 验证/文件输出脚本，不能引入浏览器 bundle。实验每次实际运行后 `setTimeout(0)` 让出主线程。

### 配置

|字段|默认|意义|
|---|---:|---|
|seed|42|具名、按实体键控随机流|
|strategy|D|A/B/C/D 字符串|
|scenario|normal|normal / demand / capacity / exit|
|weeks|104|0–103周；0–11预热|
|capitalMinor|6000000|人民币分|
|predictionBias|0|观察预测乘数为 1+bias；范围−1到3|
|uptake|0.7|采纳预测排序的概率|
|guaranteeUptake|0.45|独立的收费保障选择概率；仍须资金可承担|
|capacityMultiplier|1|每服务商每周7单×倍率，向下取整|
|tenureMonths|12|公开计划周期；隐藏实际周期另有±6周扰动|
|initialAssets|260|观察期内陆续公开挂牌的初始二手物件|
|exitStopTick|78|只在exit情景停止新增需求|

三品类为净水设备、办公椅、床垫；**床垫仅允许新品购入，不参与二手匹配或保障，退出不进入模拟转售服务**。生成世界中的初始床垫物件不进入公开平台供给。每周正常新增10–16件需求，贯穿W103；4家服务商。需求下滑从W52起新增需求约降至45%，运力下滑从W52起运力降至40%。情景变化只在发生时被公开，不预先进入算法。初始物件不在W0全部可见。

## 返回 schema

`runCity(config)` 同步返回：

- `config`：归一化完整配置。
- `summary`：`cashMinor/reservedMinor/freeCashMinor/inventoryBookMinor/unpaidMinor/resultMinor`，`served/due/rate/transfers/inventoryCount/idleItemWeeks/newPurchases`，`demandItems/consumerNetSpendMinor/consumerAverageNetSpendMinor`，保障/自售退出计数、实际自售等待、取件延误、末端责任；另外提供排除预热的`comparisonResultMinor/comparisonIdleItemWeeks`。
- `snapshots`：104个周末快照；含tick、本周newDemand/due/served/transfers/newPurchases、六类财务数、库存数、单周idleItemWeeks、未完承诺与取件队列、当期公开运力。
- `groups`：`limited/standard`两种预算组；件数、到期数、满足率、净支出/需求件数、保障数。不做人群信用评分。
- `forecastEvaluation`：4周需求规则点估计的`count/mae/bias/records`。只有观察末端内可完整评价的预测进入误差。非预测组也记录同一诊断预测，但不使用其排序。
- `events`：`eventId,tick,type`和最小关联/金额信息，仅实际确认、交付、退出、取件、明确拒绝及重排事件。
- `metadata`：版本、配置/政策指纹、随机流、计量窗口、四条财务桥、现金分项、末端责任与假设。

金额存量/流量是整数分；平均数可为小数分。`rate`为0–1。现金、经营结余与库存是完整运行期余额；不能把期末留存或库存再算成一次已支付费用。`summary.served/due`采用比较期内发起、截止期已在观察期内发生的同一需求 cohort。尚未到期的最后两周需求单独留在末端责任。净支出分母包含比较期全部需求件数，包括未满足的零支出项；它是已观察支出，不是完整生命周期成本，也不能单凭较低均值声称消费者福利更高。

`runExperiment(config, onProgress?)` 异步返回：

- `config`含seeds/scenarios，默认seed101–110 × normal/demand/capacity × A/B/C/D，120真实运行。
- `runs`：逐run的config、summary、紧凑末端责任、预测误差、四桥、事件数，以及`provenance`中的引擎/世界/观察/算法/政策/行为/指标/时钟版本、配置/政策/完整世界fixture指纹；不保存全部周报/事件，按同一config可重现。
- `aggregates`：按情景×组的指标统计 `{n,mean,min,max,sd,interval95,intervalMethod}`。
- `pairedDifferences`：按情景×B−A或D−C的逐seed差值和配对均值统计；默认10seed使用df9的t区间。
- `metadata`：实验/引擎/算法版本、run数、组差异、固定条件、解释与重现命令。

指纹对完整递归排序JSON采用FNV-1a-32，仅用于可复现标识，**不是密码学完整性hash**。根交付清单应另附实际源码文件SHA-256和整合commit；不把包含自身的报告hash写回自身。

## 识别范围

|组|预测机会成本排序|收费回购保障|
|---|---|---|
|A|关|无|
|B|开|无|
|C|关|有，独立选择且资金可承担|
|D|开|有，独立选择且资金可承担|

四组均完整枚举预算/品质/就绪/截止期/服务商/时段可行候选，再排序，保留相同的提前预订和新品回退。预测只依据过去8周公开需求估计未来4周需求量，在排序中增加“把超出该居民最低品质的物件留给后续需求”的机会成本项。其公式预先固定，并不优化或预知实际未来。它不是预测转售价，更不是保障价格或最优算法。`observed-v2.mjs`不导入世界模块；输入拒绝已知隐藏字段和未来观察。B−A和D−C为同责任政策比较，C−A不是预测效应。

同一case的推荐、保障、需求、实际居住期、初始物件各用独立具名随机键，策略分支不会消耗另一组的随机流。实际签约量/资产组合可能随服务结果内生变化，但费率、保障比例、签约资金门槛、服务范围与排队规则在配对内固定。

## 财务及尾期

签约只收一次保障费，并在现金中标记回购金额＋取件费留存。退出当周兑现回购，回购金额成为平台库存成本；若取件无容量，仍持有库存成本、继续保留取件费，不取消原责任。出售时现金入账，释放对应库存成本。仓储/固定费先计费用，现金不足部分留在应付，不偷用保障留存。新品货款、居民之间的转售货款、居民交付费直接给相应对手方；平台不把它们重复算成收入。

每run验证：

1. 期初现金＋现金流入−现金流出＝期末现金。
2. 留存增加−释放＝期末留存；留存不二次扣现金。
3. 回购入库成本−销售结转成本＝期末库存账面成本。
4. 期初现金＋经营结余−库存账面成本＋未付费用＝期末现金。

末端列出未来保障回款、未来取件留存、待取件责任、未完成交付、未到期需求、自售未售件数、平台库存年龄/成本。没有虚构期末清仓收入。仍采用签约时确认服务费的简化口径，未来服务成本、库存减值、税费和完整团队成本均不完整，因此经营结余不是标准财报利润。

## 验证与复现

```sh
node regression.mjs
node run-experiment.mjs
```

回归覆盖：便宜但来不及候选过滤、第二服务商容量回退、公开输入/隐藏信息边界、床垫新品范围、预测开关保持相同可行候选集合、确定性复现、尾周持续流入、专门退出情景、整数金额和四桥、模拟顺序执行的资产不重复交付、采纳为零的消融、资金/运力为零时未履行/应付、运力压力保留原责任。

研究入口`runCityWithWorld(config, injectedWorld, {traceThroughTick})`允许给执行器注入隐藏世界，记录引擎**实际调用**观察投影和建议函数的公开快照/Proposal。F06把两份世界分别完整运行：公开前缀相同，但未来需求品类、未来初始物件释放、已入住者隐藏居住期不同；验证世界指纹和末期结果确实改变，且W0–12真实观察/建议trace逐字相同。该入口不向算法传入隐藏world；生产界面应继续使用`runCity(config)`。

这些回归没有宣称实现F03/F04的生产并发与命令幂等，也没有实现F05生产政策升级/服务商异步拒单协议。隐藏未来测试验证所测模拟引擎的真实观察/建议前缀，不构成对所有潜在侧信道的证明。没有取消、损坏争议、真实付款、消费者支付意愿或时间价值实证。保障费不纳入物件预算过滤，是单独选择的费用假设；需要产品研究确认，不能把该采纳率当市场证据。
