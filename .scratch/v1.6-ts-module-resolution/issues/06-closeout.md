# 票 06 — 精度复核与收口（v1.6.0）

Status: done

## 内容

1. 精度复核：三仓读数 vs 票 02 冻结基线，逐条归因；Phase 1/2 分别记录变化量。
2. README `Known Limitations` 第 2 条改写：从「不解析 import 声明」改成「已解析相对 import 与
   tsconfig 别名；bare specifier / workspaces 仍是边界」——**只写实际做到的**。
3. 版本五处 1.6.0（bridge-adapters 独立版本线不动）+ CHANGELOG `[1.6.0]`。
4. 门禁复跑：`build` / `typecheck` / 控制面 + web + bridge 单测 / e2e（≥73 全绿）。
5. CONTEXT.md 若有术语变化（Module Scope / Call Edge 的绑定口径）同批更新。

## 验收

- 门禁数字记进本票 Comments。
- v1.6 完成定义（spec §完成定义）逐条核对，未做到的不打勾。

## Comments

- 2026-10-26 立项。
## Comments

- 2026-10-26 完成。版本五处 = 1.6.0；CHANGELOG `[1.6.0]` 含实测数字与「1301 是上界」的口径
  澄清；README `Known Limitations` 第 2 条改写为「只解析相对 import（L1），别名/包名互引仍是
  边界」；README 徽章与「当前版本」同步，npm 实情仍写 1.5.1 已上架 + 工作树 1.6.0 未上架。
- 门禁：cp tsc 0、71 文件 899 测试；web tsc 0、41 文件 433 测试；bridge 26；build 四前缀 0；
  e2e 73/0（含 version-consistency / readme-version / /health 三门 1.6.0 一致）；
  三仓 compare `lazygit`/`petclinic` IDENTICAL。
- `HANDOFF.md` 与 `CONTEXT.md` 未动：本批没有开放项要移交，术语定义（Call Edge / Anchor /
  Static Analysis Break）也未改变语义——歧义是既有「必须标记」纪律的延伸，不是新术语。
