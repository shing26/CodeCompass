# 06：G6 — styles.css 全迁清零（销 V27-11⑤，D7）

> *Parent spec：`.scratch/v030-degeekify/spec.md`（D7：全迁清零；U1 遗留迁移窗）。*

Status: open
标签：视觉 / 债务清零 / 来源：v027 台账 V27-11⑤。

## 现状

styles.css 85 行 4 段：plan 卡 L3-28（.plan-risk/.plan-action 三对红橙绿 rgba 绕 token）、`.chat-starter` 死胶囊 L30-37、starter 网格 L40-65、scenario 导览 L67-85（#fff）；index.css 另有两处 shadow 字面量复刻 accent（L37,L70）。硬编码蓝 rgba(79,156,249) 历史票已清零。

## Agent Brief

**Summary:** ①grep `.chat-starter` 全仓零引用则整段删除（有引用并入新 starter 卡类）；②plan 卡/starter 网格/scenario 三段改 Tailwind 语义类（bg-surface/border-line/text-danger、色经 token 自动跟主题），styles.css 整文件销号（main.tsx/App.tsx import 摘除）；③mermaid 伪元素角标中文（index.css:259 BROKEN→断链）随本票处理（G4 票面移交项）；④shadow-neon 字面量（index.css:37,70）改 `rgb(var(--color-accent) / 0.16)` token 引用。
**Acceptance:** ①styles.css 文件不存在（git rm 记录）；②web 全量绿（PlanCardView/ChatView starter/ScenarioGuide 测试若断 class 同票改）；③两视口实拍对比（plan 卡/scenario 步导/starter 网格三屏）肉眼无回退；④e2e 62 + UI 冒烟绿。

## Comments
