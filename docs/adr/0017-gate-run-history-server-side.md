# Gate 历史 = 服务器端执行史，而非 CI 遥测

v0.26-B「CI 历史报表」的 grilling 中确认了承重事实：门禁判定 `evaluateDiffPolicy` 历来只在 CI 机器上的 CLI `pr-summary` 里执行，与 workbench 服务器是两个进程、结果从不回流——服务器对「CI 跑过什么」零知识。我们决定：报表的正式语义是「门禁运行史」，主体数据来自 workbench 服务器端自己执行 `analyzeDiff + evaluateDiffPolicy` 并落库（`gate_runs` 表）；CLI 侧真 CI 上报（`pr-summary --report-to`）被降为**预留的纯 additive 扩展**，不进 v0.26。理由是 CodeCompass 的 Local-First 个人定位：CI 机与服务器通常同机同包，要求用户改 CI yaml 才有数据的方案默认交付一张空报表；而服务器端执行零配置即有历史，引擎函数本就是纯函数、无新计算能力。拒绝的备选：双写数据源（CI 上报 + 服务器执行并存，一致性成本无对价）、纯 CI 上报（空报表体验）。后果：未来读者若问"为什么不接 CI"——答案在此；接入时新增 ingestion 端点即可，`gate_runs` schema 无需变更（source 列天然区分）。
