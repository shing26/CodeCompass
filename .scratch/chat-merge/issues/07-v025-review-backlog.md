# 07 — v0.25.0 收口双轴 review 遗留（v0.26 候选，不阻塞发布）

来源：v0.25.0 收口双轴 code-review（fixed point 88f1985）。P1 已全部随收口修复
（dialog 契约兜底不再外泄 error、前端 15s 超时降级、非 Windows 隐藏浏览按钮、
deps.ts 死 import、CHANGELOG 失实表述）；以下为 judgement-call 级遗留：

1. **pickFolder 域错位（Feature Envy）**：`RepoQAClient.pickFolder` 挂在
   `ChatMergeClient`（调用点 `client.chat.pickFolder()`），但目录选择属仓库
   导入域。迁移到根客户端时注意 ImportRepoModal/TopBar 测试的 mock 形状。
2. **requireRepo 助手（Duplicated Code）**：`if (!repo) 404 "Repo not found"`
   样板在 routes/{repos,analysis,workbench}.ts 重复约 20 处——批次 2 是纯搬迁
   所以原样保留；v0.26 抽 `requireRepo(deps)`（放 routes/deps.ts）统一。
3. **commit message 记录误差（不改历史）**：cff344d 标题写 "POST /api/dialog/
   folder"，实现与文档均为 GET。仅记录在案。

## QA 定点回归追加（2026-09-10，报告 .scratch/chat-merge/qa/report-v025-regression.md）

QA-01（P0）已当场修复：TopBar 未透传 onPickFolder 致浏览按钮恒不渲染——补
透传 + 2 条组合层测试（web 272/272），真实 Chromium 双画像复核通过（Win32 渲染/
Linux UA 隐藏）。其余 QA 发现**均先于 v0.25 存在于 HEAD**（反证重构批行为保真）。与报告编号对照：QA-02→条目 4（P1）、QA-03→5、QA-04→6、QA-05→7（P2）、QA-06→8、QA-07→9（P3）：

4. **P1 移动端抽屉复开死锁**：检查器遮罩关闭后，点同一文件节点永不可复开
   （`useEffect [inspector.file]` 只在 file 变化时置 open）。改 `openFile` 内
   显式 setInspectorOpen(true)。
5. **P2 Monaco worker pageerror**：每次开检查器 `editor.worker` 抛 3 条未捕获
   `toUrl` 错误（jsdom 外的真浏览器也复现）——worker URL 配置问题。
6. **P2 goBack 库切换失同步**：TopBar 后退到别的 repo 后 URL `?repo=` 与 UI
   选库不一致（popstate 只处理 URL→UI，未处理 select 后 pushState 的对称面）。
7. **P2 idle 库差异分析**：无提交历史库点「运行差异分析」直接吐原始 git 输出，
   空 ref 也未禁用按钮。
8. **P3 首屏引导旧 tab 名**：ScenarioGuide 空态文案仍写「架构指标」「智能体
   对话」（8ac9bea 轮改名漏网），与新 tab 名「架构仪表盘」「架构问答」并存。
9. **P3 深链错位**：`/?mode=diff` 无库时 tab 高亮「Diff 影响面」但主区渲染
   引导画布；`?mode=chat` 深链被 replaceState 静默归一为 `?mode=incident`。

## v0.26 排期预留（v0.25 计划书「明确不做」的正式承接，勿散佚）

来自获批计划（.zcode/plans/plan-sess_31149989…md §明确不做）与
`.scratch/chat-merge/spec.md` L119，两项已承诺 v0.26 处理：

- **A. 问答/演进入口心智分离文案大改**：架构问答（读侧）与规范演进（写侧
  建议）的入口命名、引导语与空态文案整体重设计；顺手收编上表 QA-06/QA-07
  （同一动线面）。
- **B. CI 历史报表 + 受波及树**：新数据面，需先做后端存储设计（趋势表/
  快照策略），不可纯前端解决。
- 大仓性能优化、MCP 工具发现 UI 维持 backlog（记录不排期）。
