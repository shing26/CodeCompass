# Issue 01（P2）：孤儿桶 total 跨索引不稳定

- 状态：open（待线 A 排期）
- 来源：compass-copilot M3/M4 dogfooding（spec.md）
- 级别：P2——scan 核心数字跨索引漂移，动摇确定性宣称

## 现象

同一 petclinic clone（206 files / 595 symbols），两次全新索引的 `codecompass_scan` orphanedPublic total：**184 → 154**（孤儿率 30.9% → 25.9%）。lazygit 同期 hubs total 5282 → 5217 亦有小幅漂移。

## 疑似方向

符号去重/排序时序依赖；FS-watcher 残留；data-dir 复用差异。

## 建议排查法

同一仓库连续 N 次全新索引（不同 data-dir），逐轮 diff scan 载荷，定位首个发散字段；再对照 golden eval 的确定性 harness 补一条 scan 载荷 diff 断言。

## evidence

- B 轮全量载荷：`D:/compass-copilot/.scratch/m3-dogfood/lazygit-scan.json` / `spring-petclinic-microservices-scan.json`
- A 轮数字记录：`D:/compass-copilot/.scratch/m3-dogfood/report.md` §二 与正文
- copilot 侧复验脚本：`D:/compass-copilot/scripts/m3-dogfood.ts`（可复跑）

## 处理状态

（待线 A 排期时回写）
