# 票 03 — 导入路径契约诚实化

Status: agent-ready

## 背景
用户批判①："不知道填绝对路径还是相对路径"。实测：UI 文案要求绝对路径；服务端**不校验 isAbsolute**，相对路径被按服务进程 cwd 隐式解析（`upsertByLocalPath → normalizeLocalPath → path.resolve`）——文案、实现、用户预期三方不一致，且相对路径解析基准（服务 cwd）对用户不可见。

## 目标
路径契约显式、可预期、看得见：无论用户输入什么，导入前都明确显示"将导入的绝对路径"和是否存在。

## 实现要点
1. **preview 端点**（`POST /api/repos/preview`）响应补 `resolvedPath`（`path.resolve(localPath)` 后的绝对路径）+ `wasRelative: boolean`；保持 `path` 字段为清洗后原文（兼容既有调用方）。
2. **导入端点**（`POST /api/repos`）：相对路径→显式 resolve 后走原流程（保留既有宽容行为，不新增拒绝路径），但 400 错误消息带上解析后的绝对路径（"相对路径按服务进程工作目录解析为 X；该目录不存在"），让失败可诊断。
3. **Web 弹窗**：预览区加一行「将导入：<resolvedPath>」（等宽字体），相对输入时附提示「相对路径按服务所在目录解析」；提交失败时展示服务端消息原文。
4. 不改：Windows 目录选择器、引号清洗、clone 流程。

## 验收
1. 控制面测试：preview 对相对路径返回 `resolvedPath` 为绝对路径且 `wasRelative=true`；对绝对路径 `wasRelative=false`。
2. 控制面测试：`POST /api/repos` 相对路径成功时 repo.localPath 为绝对路径。
3. Web 测试：输入相对路径时预览区出现「将导入」与绝对路径文本。
4. 真机走查：输入 `services/control-plane`（相对）看到解析后的绝对路径与文件计数一致。

## Comments
**2026-10-19 落地。** 证据：
- preview 响应补 `resolvedPath` / `wasRelative`；失败消息对相对输入追加 `(resolved to <abs>)`。
- `POST /api/repos`：相对路径 resolve 后**存库**与索引（同一行 reindex 不再随 cwd 漂移）；400 消息带解析结果。
- Web 预览区：「将导入：<绝对路径>」+ 相对路径解析基准说明。
- 测试：`routes/repos-path-contract.test.ts` 3 项（相对/绝对 preview、绝对路径入库、400 消息）；`ImportRepoModal.test.tsx` 新增 resolvedPath 展示用例。
