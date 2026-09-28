# Issue 09 — `deriveAutoApprove` 保留登记（test-only 豁免）

> 依据：审计 v2 §4.3「不成立的声称」——`deriveAutoApprove` 无生产调用点，仅自身 + 测试
> 波次：波 1 ｜ 状态：**✅ 已落地（2026-09-28）** ｜ 依赖：无 ｜ 半批：B 证据诚实
> 决策依据：spec §7.1（**保留并登记**，不删）

Status: done

## 1. 现状（实测）

- `services/control-plane/src/chat/approve.ts:14` 定义 `deriveAutoApprove(tools)`；**仅 `chat/chat.test.ts:67-78` 引用**（全仓 4 处命中 = 定义 1 + 测试 3），**无生产调用点**。
- 真实注入路径：`installer.ts:92` `MCP_TOOLS.map(t => t.name)` → `:105` `autoApprove: codecompassToolNames()`。
- **纠正一处外部说法**：README:72 只写"注入工具 autoApprove 白名单"，**没有**"动态跟随 `tools/list`"的表述 → **README 不需改口**。
- 该函数 docstring 的意图已由 `MCP_TOOLS` 单源承担（`tools/list` 即由它生成）。
- 相关线索：`docs/agents/agent-line-handoff.md:64` 提到智能体线（**独立 repo**）的 MCP 客户端做"autoApprove **动态派生**"——那一侧会真的调协议 `tools/list`，这**正是本函数存在的理由**。

## 2. 落地（登记，不改行为）

1. 在 `chat/approve.ts` 顶部加一行**机器可读的豁免说明**，例如：

   ```ts
   // test-only by design: reserved for the agent-line MCP client's live tools/list
   // derivation (docs/agents/agent-line-handoff.md:64). See
   // .scratch/v1.1-retrieval-honesty/issues/09-retain-approve-for-agent-line.md
   ```

   目的：**让下一轮死码清扫不会误删它**（v1.0 后清理批的判据是"无生产调用点即删"，本函数是新判据下的例外）。
2. 在本票 Comments 登记：**为何不删**（已有明确的下游消费者，跨仓）+ **判据更新**（"无生产调用点即删"须先排除"跨仓预定消费者"）。
3. **不改** `installer.ts`、**不改**测试、**不改** README。
   - ⚠️ 2026-09-28 勘误：末半句「不改测试」与验收 1「grep 断言」自相矛盾——断言本身就是测试。实现按**验收 1 为准**：断言**折入既有用例**（`chat/chat.test.ts` 的 `deriveAutoApprove` 用例内，不新增用例、计数不变），未新建哨件；`installer.ts`、README、可用行为**确未改**（见落地记录）。

## 验收（机器可验证）

1. `chat/approve.ts` 含豁免说明字符串（grep 断言，可入现有文案/结构哨）。
2. `installer --dry-run` 输出与改动前**逐字节一致**（本票零行为变更）。
3. 控制面用例数不变、全绿。

## 验收实测（2026-09-28）

- [x] 验收 1：`chat/approve.ts:1` 起为四行豁免说明，首行即机器可读标记 `test-only by design: reserved for the agent-line MCP client`；grep 断言**折入既有用例**（`chat/chat.test.ts` 的 `deriveAutoApprove > follows the live tools/list result, sorted`，不新增用例 → 计数不变），读源文件后 `toContain` 该标记。
  - **门会红**：临时删除标记首行 → 该用例失败（`AssertionError: expected '// RED-PROOF TEMP…' to contain 'test-only by design…'`）→ 复原 → 绿。
- [x] 验收 2：`installer --dry-run`（cursor/cline/roo，临时 HOME 指向 `D:\zcode-tmp\install-probe`）输出与改动前**逐字节一致**（`cmp` 三连 IDENTICAL；含 `autoApprove` 17 项不变）。
  - ⚠️ 该一致性的口径**限定在本票提交树（b503db5）**：紧随其后的票 11 按用户决策把默认 `autoApprove` 改成 16 项（去 `remove_repo`），故此后跑不出 17 项的一致——不要把它当批次级门禁复跑。
- [x] 验收 3：控制面用例数 **737 不变**、全绿（59 文件）；typecheck 干净。

## Comments

- 2026-09-27 立项（原为"删"）；2026-09-28 按用户决策改为"保留并登记"。
- 与 v1.0 后清理批的差异：那一批删的是 6 条**无预定消费者**的真阳性死 API；本函数有跨仓预定消费者，故登记豁免。
- 2026-09-28 落地：标记写在文件顶部（4 行，含跨仓消费者指针 + spec/票面位置）；**判据更新记此**——「无生产调用点即删」须先排除「跨仓预定消费者」，本函数是新判据下的首个例外。文件面：`chat/approve.ts`（注释）+ `chat/chat.test.ts`（既有用例内断言），**未动** `installer.ts` / `README`（票面 §2.3）。