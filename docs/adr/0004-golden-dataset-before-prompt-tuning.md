---
status: proposed
---

# Golden Dataset 真值先于 prompt 调优，config 桶取决于配置解析器

决定：Phase 1 在真实 LLM prompt/tool 调优前冻结 50 题、固定 repo commit、人工标注 ground truth anchors、K 口径、匹配规则、失败分类与分桶阈值。route-chain 桶是第一个硬门槛；architecture 只回答静态可锚定的问题；config 桶只有在确定性配置 key 提取（`application*.yml`、`application*.properties`、`pom.xml` 等）落地后才计分，不能用 LIKE 检索替代。理由：没有冻结真值的 recall 指标可被口径操纵，prompt 的每次改动也无法归因；代价是 LLM 接入被推迟到 eval 基础就绪。
