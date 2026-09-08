# 03: 二进制扩展预算排除

Status: ready-for-agent

## 问题

`scanRepo`（repoqa-scan.ts:185-187）对每个文件无条件 `fileCount += 1` 并进入文件清单，大模型仓的 `.bin/.pt/.onnx/.parquet/.pkl` 等权重文件消耗 MAX_FILES=3000 预算、污染文件列表（不被读取、不计行数——报告的"I/O 开销"说法不成立，rebuttal 见 spec）。

## 任务

1. 新增 `BINARY_EXTENSIONS`：`.bin .pt .onnx .parquet .pkl .gguf .safetensors .h5 .pb .ckpt`（不含 `.jar`——jar 属构建产物且 `target/build/dist` 目录已忽略，取舍记录在 Comments）。
2. 命中扩展名：不计数、不进 files 清单，独立统计 `skippedBinary` 并在导入预览/度事件中呈现（保持知情权）。
3. 单测：混合目录扫描 fileCount 不含权重文件；preview 返回 skippedBinary。

## 验收

- 单测绿；断言 `.pt/.pkl` 不计入 fileCount 且 skippedBinary 正确。

## Comments

- 2026-08-28（code-review 记录）：在 issue 枚举之外追加 `.pickle/.npy/.npz`
  （同属数据/序列化资产）；`.jar` 维持排除（构建产物已被 target/build/dist 目录覆盖）。
  度事件侧：DISCOVERY 阶段 detail 附 `N binary skipped`。
