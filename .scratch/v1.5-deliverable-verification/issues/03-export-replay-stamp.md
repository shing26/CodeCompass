# 票 03 — export HTML 重放校验入口

Status: done

codecompass export 产出的单文件 HTML 工件内嵌重放块：repoId、commit、生成时间、
本地重放命令（codecompass trace <symbol>）与「锚点以本地同一 commit 为准」说明。
目的：工件脱离引擎环境后，读者仍可回到可验证状态（spec 决策 2）。
