# 票 01 — 探针修正与自仓复核度量

Status: done

## 背景

v1.4 票 08 的前置条件 1（先量）在 2026-10-25 用 `scripts/precision/import_resolution_probe.ts`
做过一次，数字进票 08。评审（`docs/reports/code-review-2026-10-26.md`，Standards 判断项）指出探针
自身有三处瑕疵，需要先修再复核，否则战役的立项数字不可信。

## 修法

1. `TS_EXT = /.(tsx?|jsx?|mjs)$/` 的点号未转义 → `/\.(tsx?|jsx?|mjs)$/`
   （旧写法会把 `robots`/`charts` 这类以 ts/js 结尾的非 TS 文件收进来）。
2. 扩展名清单三份（`TS_EXT` / `RESOLVE_SUFFIXES` / 内联 `stripExt`）→ 收成
   `TS_EXT` + `TS_EXT_STRIP` 两条常量，`stripExt` 与返回值去后缀都引用同一条。
3. 删死变量 `aliasCalls`（赋值后从不读取），样本数组改名 `pinnableSamples`。

## 复核结果（2026-10-26，self 仓 `13b1a34`）

| commit | tsFiles | 跨文件调用 | 同名歧义 | import 可唯一钉死 |
|---|---|---|---|---|
| `38deb70` | 243 | 4055 | 3274 | 1301 |
| `13b1a34` | 243 | 4061 | 3280 | **1301** |

结论：**头条数字 1301 不变**——旧探针的 bug 没有把读数带偏；跨文件调用 +6、歧义 +6 是这三天
代码增长的正常漂移。报表 `scripts/precision/out/import_probe_self.json`。

## 验收

- 探针可重跑、报表落盘、数字与上表一致。
- 探针不参与门禁（只是度量工具），故无 e2e 影响。

## Comments

- 2026-10-26 完成。复现命令：
  `node --max-old-space-size=4096 services/control-plane/node_modules/tsx/dist/cli.mjs scripts/precision/import_resolution_probe.ts self`
