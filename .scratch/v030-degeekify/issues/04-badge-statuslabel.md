# 04：G4 — statusLabel 映射 + Badge/CountPill 双件（销 V27-11④，D4/D6）

> *Parent spec：`.scratch/v030-degeekify/spec.md`（表 C + D6 组件化双件）。*

Status: closed
标签：组件 / 文案 / 来源：v027 台账 V27-11④。

## 现状

机器枚举直出徽章：VERIFIED/BREAK/SUSPECT（EvidenceCard STATUS_BADGE）、PASS/FAIL（CiGateView）、LOW/MEDIUM/HIGH、EXTEND/DEPRECATE（PlanCardView）、CONTROLLER/ENTITY（CommandPalette）、BROKEN（Canvas）、dirty/sensitive。9 个徽章家族 ~55 实例无共享组件。

## Agent Brief

**Summary:** `client/statusLabel.ts`（表 C 契约值→中文，未知透传）+ `components/ui/Badge.tsx`（tone×mono×outline）+ `components/ui/CountPill.tsx`（fill×outline）；枚举直出点全迁双件；testid 经 props 透传零改名；closeout marker 契约不碰。
**Acceptance:** ①枚举直出位点零残留；②e2e marker 契约零改动；③web 全量绿（徽章文本断言同票改）；④ui_smoke 绿；⑤testid diff 零变更。

## Comments（2026-09-16 实施收口）

- **新建三件**：`client/statusLabel.ts`（14+ 枚举映射：已验证/断链/存疑/通过/未通过/低中高 风险/扩展挂载/安全下线/新增·修改·删除/控制器·服务·实体 + **惯例五轴中文化**（返回值包装/接口实现风格/基类约定/依赖注入风格/包结构布局/注入环）+ role interface/impl/single——表 B 之外的新侦察裸面，规范演进视图直出 `return_wrapping` 等英文标识符属同一病）+ `statusLabel.test.ts`（3 例：全表映射、未知透传、映射值退役词自净）。`ui/Badge.tsx`（6 tone + mono + outline，语义 token 色自动跟主题）、`ui/CountPill.tsx`（fill/outline）。
- **迁移位点**：EvidenceCard（STATUS_BADGE→STATUS_TONE + Badge outline + statusLabel）、CiGateView（riskBadgeClass→riskTone、gate-run-status/gate-run-dirty(未提交改动)/gate-risk-badge 三徽章、testid 保）、CommandPalette（anchor type→Badge、rank→CountPill）、PlanCardView（intentType/riskLevel/action 三处文本过表）、Canvas（affected/api/sql 计数丸→CountPill、BROKEN→断链、语言徽章→Badge、ROLE_COPY 已 G3）、Inspector（reverse-deps 计数→CountPill、slice-chip→Badge mono outline）、Sidebar（动词/语言/callee 徽章→Badge）、DashboardView（highlight/值已脱敏/敏感/配置组/控制器/深度→Badge）、EvolutionView（轴徽章→Badge、echo intentType、checklist action、conflict axis 人话化）。
- **保留面（登记）**：watcher/privacy/masked 三枚状态胶囊（xl 响应式+圆点结构，非徽章）；StatusStepper 序号圆（状态环非徽章）；mono 交互 chip（tech-chip/caller 等 **button 可导航件**——Badge 是 span，按钮迁移违零行为变更，留常量化候选归 G6/G8）；mermaid 伪元素角标（CSS 域，G6）；EvidenceCard commit 片（数据芯片）。徽章族 9→双件 + 上述具名残留，符合 D6「收敛」非「清零」。
- **测试联动 8 处**：EvidenceCard(3)/CiGateView(5)/EvolutionView(1)/PlanCardView(1)/Canvas(1 BROKEN→断链)；**哨自燃案**：statusLabel.test 退役词自净表整词字面量被全文扫命中——按工艺拆分构造修复（教训重申：测试辅助表同守拆分纪律）。
- **英文表不扩词裁决**：VERIFIED/PASS/dirty 等机器值在比较语句字面量中合法长存（`run.status === 'PASS'`），区域扫描无法区分「比较值」与「展示值」——强行入表=机制性误伤，改以本票「展示出口全过 statusLabel」+ 测试钉中文保证；异常路径已登记于 contracts 表头注。`Workbench views` 等 G3 已入表词零回归（哨绿）。
- 门禁：tsc 四包 0 错 | web **363**（+3）| UI 冒烟 PASS | vite build 绿 | testid diff 复核零改名。**cp/e2e/docker 豁免**（本票零服务端文件——G3 后 cp 侧未再动）。
