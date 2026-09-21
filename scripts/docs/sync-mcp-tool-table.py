#!/usr/bin/env python3
"""Generate (or verify) the README MCP tool table from `MCP_TOOLS`.

Issue 07 hard condition #1 — README generation sync.

Why this exists: ticket 03(b) bumped the README's prose count from 15 to 17 but
left the enumerable table at 15 rows, and the acceptance box was ticked anyway.
A one-off hand edit cannot prevent that class of drift, because the same fact
(tool names + count) lives in two places. So the tool list and the count are
now RENDERED FROM `MCP_TOOLS` — the single source — and this script both writes
the block and fails when someone edits either side by hand.

    python scripts/docs/sync-mcp-tool-table.py           # rewrite the block
    python scripts/docs/sync-mcp-tool-table.py --check   # exit 1 when out of sync

The gate calls --check; the failure message names the command to run. Rendering
is deterministic, so "regenerate and diff" is a complete parity proof.

Adding a tool: add it to MCP_TOOLS, then add its label to LABELS below. A tool
without a label (or a label without a tool) is a hard error — the block never
silently loses a row. Deprecated tools go in DEPRECATED; their row then carries
the machine-readable token `deprecated`.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MCP_SOURCE = ROOT / "services" / "control-plane" / "src" / "mcp" / "repoqa-mcp.ts"
README = ROOT / "README.md"

BEGIN = "<!-- mcp-tools:begin -->"
END = "<!-- mcp-tools:end -->"

# Tool name -> 用途 cell. Editorial wording lives here; the SET of tools does not.
LABELS: dict[str, str] = {
    "codecompass_index_repo":
        "**索引入口**：克隆 GitHub 仓库或索引本地目录；异步契约——立即返回 `indexing`，轮询 `list_repos` 至 ready/error（ADR-0016）",
    "codecompass_list_repos":
        "列出已索引仓库（id / status / fileCount / symbolCount / error 根因）",
    "codecompass_remove_repo":
        "移除索引（级联清除符号/事件，磁盘保留；indexing 中拒删）",
    "codecompass_scan":
        "**自荐发现**：五桶候选——零调用者孤儿（ADR-0018 后只含**可调用符号**，类型声明与接口成员按规则排除、计数于 `census.excluded`）"
        " / PageRank 热点 / 超长方法 / 深链入口 / 超大文件，每桶带锚点与下一步工具引导",
    "codecompass_trace_call_chain":
        "解析确定性静态调用链",
    "codecompass_get_dashboard":
        "聚合零 Prompt 架构驾驶舱",
    "codecompass_get_config_evidence":
        "配置 key 证据（只返回 file:line，不返回 value）",
    "codecompass_get_tours":
        "返回 Onboarding Tour",
    "codecompass_reverse_deps":
        "who-uses 反向调用者查询",
    "codecompass_get_pr_impact":
        "Git PR 架构影响面分析",
    "codecompass_get_subgraph_context":
        "**Graph RAG 子图提取**：上游 1 层调用方 + 下游 1~3 层被调方、骨架折叠、Token 剪枝与凭据脱敏",
    "codecompass_diagnose":
        "**跨栈根因穿透**：前端组件 → 路由 → Service → Mapper 分层链路，逐层 VERIFIED/BROKEN/SUSPECT",
    "codecompass_refactor_plan":
        "**重构爆炸半径**：直接/间接调用方、受影响路由与前端组件、风险评级与迁移步骤",
    "codecompass_domain_radar":
        "**领域全景雷达**：出入度 + 确定性 PageRank 的 Hub 节点、Top APIs、持久化底座与意图锚点（零 embedding）",
    "codecompass_plan_evolution":
        "**演进方案（`module_evolution` 的接替者）**：EXTEND 挂载点 + 声明级事务边界 + 解耦模式与脚手架；DEPRECATE 固定点级联孤立死代码 + 清理 Checklist（补丁仍归 LLM 层）",
    "codecompass_get_conventions":
        "约定画像五轴（return_wrapping / interface_impl_style / di_style / naming / async_pattern），邻居优先仲裁",
    "codecompass_module_evolution":
        "保留仅为向后兼容",
}

# Tools superseded by another tool. Their row must carry the literal `deprecated`
# token so the supersession is machine-readable, not just prose.
DEPRECATED: dict[str, str] = {
    "codecompass_module_evolution": "codecompass_plan_evolution",
}

# Ordered as declared in MCP_TOOLS; that order is the registration order clients see.
TOOL_NAME_RE = re.compile(r"^\s*name:\s*'(codecompass_[a-z_]+)'", re.MULTILINE)
TABLE_ROW_RE = re.compile(r"^\|\s*`(codecompass_[a-z_]+)`\s*\|", re.MULTILINE)


def declared_tool_names() -> list[str]:
    """Tool names in declaration order, read from the single source."""
    names = TOOL_NAME_RE.findall(MCP_SOURCE.read_text(encoding="utf-8"))
    if not names:
        raise SystemExit(f"sync-mcp-tool-table: no tool names found in {MCP_SOURCE}")
    if len(names) != len(set(names)):
        dupes = sorted({n for n in names if names.count(n) > 1})
        raise SystemExit(f"sync-mcp-tool-table: duplicate tool names in MCP_TOOLS: {dupes}")
    return names


def render_block(names: list[str]) -> str:
    missing = [n for n in names if n not in LABELS]
    orphaned = sorted(set(LABELS) - set(names))
    if missing:
        raise SystemExit(
            "sync-mcp-tool-table: no label for "
            + ", ".join(missing)
            + " — add it to LABELS in this script (the table must never silently drop a tool)"
        )
    if orphaned:
        raise SystemExit(
            "sync-mcp-tool-table: label(s) for tool(s) that no longer exist: "
            + ", ".join(orphaned)
            + " — remove them from LABELS"
        )

    rows = []
    for name in names:
        label = LABELS[name]
        if name in DEPRECATED:
            label = f"**已弃用（deprecated）**——由 `{DEPRECATED[name]}` 接替；{label}"
        rows.append(f"| `{name}` | {label} |")

    return "\n".join(
        [
            BEGIN,
            f"`codecompass mcp <path>` 启动标准 stdio MCP 服务，当前提供 **{len(names)} 个**确定性工具"
            "（全部零 LLM、结果确定性可复现）：",
            "",
            "| 工具 | 用途 |",
            "| --- | --- |",
            *rows,
            END,
        ]
    )


def current_block(readme: str) -> str:
    start = readme.find(BEGIN)
    end = readme.find(END)
    if start == -1 or end == -1 or end < start:
        raise SystemExit(
            f"sync-mcp-tool-table: markers {BEGIN} / {END} not found in {README}"
        )
    return readme[start : end + len(END)]


def main(argv: list[str]) -> int:
    check = "--check" in argv
    names = declared_tool_names()
    expected = render_block(names)

    readme = README.read_text(encoding="utf-8")
    actual = current_block(readme)

    if actual == expected:
        print(f"sync-mcp-tool-table: README tool block in sync ({len(names)} tools)")
        return 0

    if not check:
        README.write_text(readme.replace(actual, expected), encoding="utf-8")
        print(f"sync-mcp-tool-table: README tool block rewritten ({len(names)} tools)")
        return 0

    # Bidirectional comparison so the report says which direction drifted.
    declared = set(names)
    documented = set(TABLE_ROW_RE.findall(actual))
    undocumented = sorted(declared - documented)
    stale = sorted(documented - declared)
    print("sync-mcp-tool-table: README tool block is OUT OF SYNC", file=sys.stderr)
    if undocumented:
        print(f"  declared in MCP_TOOLS but missing from the README table: {undocumented}", file=sys.stderr)
    if stale:
        print(f"  in the README table but not declared in MCP_TOOLS: {stale}", file=sys.stderr)
    if not undocumented and not stale:
        print("  same tool set, but the rendered block differs (prose count or wording)", file=sys.stderr)
    print("  fix: python scripts/docs/sync-mcp-tool-table.py", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
