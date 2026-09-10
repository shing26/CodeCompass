# CM-02：dist 构建产物新鲜度无防护，陈旧 dist 静默回退已修复代码

Status: ready-for-agent
标签：CM-02 / P3（流程）/ 来源：chat-merge 终验复验新增 QA-F-08
类别：配置运维 / 发布流程风险

## 现状（88f1985 代码核实）

- `dist/cli.js` 为 gitignored 构建产物，不随提交重建；`.github/workflows/ci.yml` 与 `release.yml` 仅 build 自用（"gate needs dist/"），无任何 src↔dist 新鲜度断言。
- 实际发生：复验时仓库中 dist mtime（08:31）早于修复提交（10:29）2 小时，内含 0 处 DSML 处理——直接起服务会测/跑旧代码。
- 风险场景：本机长驻实例、部署机复用既有 dist 时，修复静默失效且无任何告警。CI 门禁（构建两次比对）**无法**发现远端机器上的陈旧 dist，故推荐运行时自检。

## 修法建议

- 主方案（运行时自检，推荐）：control-plane 启动路径（`cli.ts` 或 server bootstrap）比较 dist 与 src 目录的递归最新 mtime；dist 落后于 src 时向 stderr 输出新鲜度警告（不打断启动），文案指明"请重新 npm run build 或改用 CI 产物"。
- 辅助方案：README/HANDOFF 部署节写明一句口径——"部署必须从当前 src 执行 npm run build，或直接消费 CI 产物；禁止复用仓库/机器上既有的 dist"。

## 验收标准

1. 构造 dist 落后 src 的目录（touch 旧时间戳），启动服务时 stderr 出现新鲜度警告；dist 领先/一致时无警告。
2. 警告不打断服务启动（进程正常 serve）。
3. 单测覆盖 mtime 比较函数的三个分支（陈旧/新鲜/缺失 src）。

## Comments
