## Comments（2026-09-16 实施收口）

- **111→0**：`text-[11px]`×48 行→`text-xs`(12px)、`text-[10px]`×43 行与 `text-[9px]`×20 行→`text-micro`(10px, leading 1.35)，覆盖 19 文件（EvolutionView 17/Inspector 15/CiGateView 10/Sidebar 9/ArchitectureDeltaView 8/DashboardView 7/SubgraphPanel 6/CommandPalette 6/ChatView 6 行含 :98 双命中/Canvas 6/StatusStepper 4/EvidenceCard 4/TopBar 3/MermaidDiagram 3/QuickTours 2/TourPlayer 1/StackTraceInput 1/ImportRepoModal 1/App 1）。豁免登记：Monaco `fontSize:13`（Inspector.tsx:375 编辑器配置）、brand-marks.ts SVG `font-size`（图内渲染域）。
- `grep -r "text-\[Npx\]" src`（排除 .mimosa 快照目录）= **零命中**；`text-\[` 全域亦零任意值。
- 测试零改动：全量 360/360 绿——无任何测试钉 class 字符串（侦察预估「理论零红」兑现）。
- 门禁：web tsc 净 + vite build 成（`text-micro` 已进 dist CSS，管道验证）+ UI 冒烟 PASS。**cp/bridge/e2e/docker 豁免**（本票 diff 零 cp/contracts 文件，纯 web class）——豁免理由在此留痕，G8 终跑全套兜底。
- 实拍裁量：spec 验收门要求视觉票两视口实拍；G2 的 before 素材缺失期不逐票拍（before=v0.29.0 tag 构建物），**实拍 before/after 对照集中随 G8 终轮**，本票以 grep+测试+冒烟为据。此偏离本票面记录，G8 票面兑现。
- 下游约束生效：G3/G4/G6 布局文件改动不得再引入 `text-[Npx]`（G8 终扫复查）。
