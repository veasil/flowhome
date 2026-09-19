# Flowhome 文档导航

初次了解项目，请先读[仓库首页](../README.md)，再按角色选择文档。

| 目的 | 文档 |
| --- | --- |
| 体验当前市场和研究台 | [多案例市场说明](../public/downloads/market-research.md) |
| 核对最新实际交付 | [市场与研究台验证记录](evidence/v3/market-research.md) |
| 理解系统模块与边界 | [系统架构](architecture/v2-system.md)、[模块契约](architecture/v2-contracts.md) |
| 理解城市计算 | [引擎接口](../lib/flowhome-v2/engine/README.md)、[研究与运营说明](../public/downloads/v2/guide.md) |
| 查看可复现数据 | [120 次实验报告](../public/downloads/v2/experiment.json)、[实验配置](evidence/v2/experiment-config.json) |
| 复用 Agent 工作流 | [协作协议](workflow/protocol.md)、[实施范围](workflow/implementation-scope.md)、[运行记录](workflow/run-002.md) |
| 查看任务与独立审查 | [已验收范围](../workflow/release-v2.json)、[最新独立审查](../workflow/reviews/market-research/) |
| 理解品牌 | [品牌系统](brand-system.md) |
| 本地开发与环境 | [开发运行手册](development-runtime.md) |
| 回看方案演进 | [初始执行计划](execution-plan.md)、[版本记录](versions/)、[初始模型说明](model-guide.md) |

## 版本阅读原则

早期计划、架构设计和初始模型说明保留当时的设想，并不表示全部实现。当前界面、最新验证记录与已验收任务应一起阅读；原始完整系统目标仍在 [workflow/v2.json](../workflow/v2.json)，未整体标为完成。

真实记录为 0，业务演示和城市模拟尚未打通。不要将模拟结果解释为真实市场效果，或将旧版本验收当作新版本重新验证。
