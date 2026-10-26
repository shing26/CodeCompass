# 票 03 — export HTML 重放校验入口

Status: done

codecompass export 产出的单文件 HTML 工件内嵌重放块：repoId、commit、生成时间、
本地重放命令（codecompass trace <symbol>）与「锚点以本地同一 commit 为准」说明。
目的：工件脱离引擎环境后，读者仍可回到可验证状态（spec 决策 2）。
- **2026-10-27 追认（v1.6.1 票 01，评审 L2）**：实际落地的重放命令是
  `codecompass export "<symbol>"`（`artifact-report.ts`），不是票面写的 `codecompass trace <symbol>`
  ——`trace` 输出的是终端调用树，**复现不出**这份 HTML 工件；`export` 才是同一命令。
  另：重放块内没有「生成时间」字段，时间在同页 meta 行（`export-artifact.ts` 的
  `generated <ISO 时间>`），读者仍能看到。以实现为准，票面文字为历史记录。
