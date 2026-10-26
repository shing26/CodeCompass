import path from 'node:path';
import fs from 'node:fs/promises';
import {
  STATIC_ANALYSIS_BREAK_DYNAMIC,
  STATIC_ANALYSIS_BREAK_EXTERNAL,
  STATIC_ANALYSIS_BREAK_UNRESOLVED,
  STATIC_ANALYSIS_BREAK_AMBIGUOUS
} from '../../../../packages/contracts/src/index';
import { VERSION } from '../version';

/**
 * v1.5 票 01/02 — 输出证据契约（output contract）。
 *
 * 17 个 MCP 工具的输入签名冻结（ADR-0020），但返回体此前只有编译期 TS
 * interface，证据字段的完整性对消费者是不可验证的断言。本模块为每个
 * 返回体生成机器可校验的 verification 回执：
 *
 *   - 锚点存在性：递归提取 (file, line) 对，对照仓库根做物理校验——与
 *     chat 侧 raw-file 校验同一判据；
 *   - 断链标记：BREAK / EXTERNAL / DYNAMIC 等枚举值逐字段清点，消费者
 *     读到的是「这批结论里有多少条静态证据断口」的确定性读数。计数认两种
 *     线上形态：diagnose 的裸枚举值（`status: 'BROKEN'`），以及 trace hop 的
 *     `break: true` + 整句 `reason`（v1.5.1 票 01 修正——后者此前漏计）；
 *   - verdict 任一项不通过都明确写明（diagnostics 逐条带 JSON 路径），
 *     绝不静默交付——「宁可标记，绝不编造」的对外延伸。
 *
 * 回执是增量字段：不修改载荷、不改工具签名，消费方可以选择忽略。
 */

/** 静态证据断口的裸枚举值——载荷里直接出现的值即计数，语义见 ADR-0002 / ADR-0005。
 *  'STATIC_ANALYSIS_BREAK' 不在表内：它不是线上值，而是 contracts 里三个整句常量的
 *  概念名（v1.5.1 票 01 删死键）。 */
const BREAK_MARKER_VALUES = new Set([
  'BREAK',
  'BROKEN',
  'EXTERNAL',
  'DYNAMIC',
  'UNRESOLVED',
  'SUSPECT'
]);

/**
 * trace hop 的真实断口形态是 `break: true` + 整句 `reason`（见
 * packages/contracts/v1.ts 的 RepoQaTraceHop），reason 取值为 contracts 的
 * 三个整句常量之一（可能带 ` HTTP GET /x` 后缀）。按常量归类到 spec 的枚举
 * 读数——不另写一份字符串，否则就是第二把尺。
 */
function classifyBreakReason(reason: unknown): string {
  if (typeof reason !== 'string') return 'BREAK';
  if (reason.includes(STATIC_ANALYSIS_BREAK_DYNAMIC)) return 'DYNAMIC';
  if (reason.includes(STATIC_ANALYSIS_BREAK_EXTERNAL)) return 'EXTERNAL';
  if (reason.includes(STATIC_ANALYSIS_BREAK_UNRESOLVED)) return 'UNRESOLVED';
  if (reason.includes(STATIC_ANALYSIS_BREAK_AMBIGUOUS)) return 'AMBIGUOUS';
  return 'BREAK';
}

/** 载荷中被视为锚点的字段名（file 侧 / line 侧各取首个命中）。 */
const FILE_KEYS = ['file', 'filePath'] as const;
const LINE_KEYS = ['line', 'lineStart', 'startLine', 'callLine'] as const;

/** 单条物理锚点（载荷中提取，附 JSON 路径用于诊断定位）。 */
export interface EvidenceAnchor {
  file: string;
  line: number | null;
  path: string;
}

export type VerificationVerdict =
  /** 有锚点且全部通过物理校验——文件存在，且载荷给出的行号落在文件行数内。 */
  | 'VERIFIED'
  /** 有锚点未通过校验——diagnostics 逐条给出位置（缺文件 / 行号越界 / 字段非法）。 */
  | 'ANCHORS_MISSING'
  /** 有锚点但没能校验完：仓库根不可得，或锚点数超上限（截断量见 diagnostics）。 */
  | 'UNCHECKED'
  /** 载荷中没有任何锚点——确定性陈述，不是失败。 */
  | 'NO_EVIDENCE';

/**
 * 回执内部的诊断码。注意：这不是 HTTP 错误面（`{error, code}` 那套在
 * packages/contracts/src/error-codes.ts），而是回执自带的证据诊断码，
 * 命名同风格但不进 HTTP 码表——它从不出现在 HTTP 响应体里。
 */
export interface VerificationDiagnostic {
  /** JSON 路径，如 "hops[2].file"；回执级诊断用 "anchors"。 */
  path: string;
  code:
    | 'ANCHOR_FILE_MISSING'
    | 'ANCHOR_LINE_OUT_OF_RANGE'
    | 'ANCHOR_FIELD_INVALID'
    | 'ANCHORS_UNCHECKED'
    | 'ANCHORS_TRUNCATED';
  message: string;
}

export interface VerificationReceipt {
  engineVersion: string;
  tool: string;
  verdict: VerificationVerdict;
  /** 载荷中提取到的锚点总数——与 anchorsChecked 的差额就是没校验到的量。 */
  anchorsTotal: number;
  anchorsChecked: number;
  /** 未通过校验的锚点（缺文件 / 行号越界 / 字段非法）。 */
  anchorsMissing: { path: string; file: string; line: number | null }[];
  breakMarkers: Record<string, number>;
  diagnostics: VerificationDiagnostic[];
}

interface Extracted {
  anchors: EvidenceAnchor[];
  breakMarkers: Record<string, number>;
}

/** 递归走一遍载荷：收集锚点对象与断链标记计数。数组与嵌套对象都走。 */
export function extractEvidence(value: unknown, base = ''): Extracted {
  const anchors: EvidenceAnchor[] = [];
  const breakMarkers: Record<string, number> = {};

  const visit = (node: unknown, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, idx) => visit(item, `${at}[${idx}]`));
      return;
    }
    if (node === null || typeof node !== 'object') {
      // 断链标记也以裸字符串出现在数组里（如 steps: ['BREAK']）。
      if (typeof node === 'string' && BREAK_MARKER_VALUES.has(node)) {
        breakMarkers[node] = (breakMarkers[node] ?? 0) + 1;
      }
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = at ? `${at}.${key}` : key;
      visit(child, childPath);
    }
    const record = node as Record<string, unknown>;
    // v1.5.1 票 01 — trace hop 的断口不是裸枚举值，而是 break:true + 整句 reason，
    // 等值匹配永远落空。按 reason 归到 spec 的枚举读数；无 reason 也算断口。
    if (record.break === true) {
      const marker = classifyBreakReason(record.reason);
      breakMarkers[marker] = (breakMarkers[marker] ?? 0) + 1;
    }
    const fileKey = FILE_KEYS.find((k) => typeof record[k] === 'string' && record[k]);
    if (fileKey) {
      const lineKey = LINE_KEYS.find((k) => typeof record[k] === 'number');
      anchors.push({
        file: String(record[fileKey]),
        line: lineKey === undefined ? null : (record[lineKey] as number),
        path: at
      });
    }
  };

  visit(value, base);
  return { anchors, breakMarkers };
}

/** 单条锚点的校验结局。unchecked 表示环境不够（无仓库根），不是失败。 */
type AnchorOutcome =
  | { kind: 'verified' }
  | { kind: 'unchecked' }
  | { kind: 'file_missing' }
  | { kind: 'line_out_of_range'; line: number }
  | { kind: 'line_invalid'; line: number };

/**
 * 目标行是否落在文件行数内——按 64KB 块读到目标行为止，不整读大文件
 * （出库路径上的上限是 500 条锚点，整读会把延迟放大一个量级）。
 *
 * 行数口径：以 \n 计数；末尾换行不额外算一行。文件末行带换行时，比真实
 * 行数大 1 的行号会被放过——宁可漏判一次越界，也不误杀合法锚点。
 */
async function lineExistsInFile(target: string, line: number): Promise<boolean> {
  const handle = await fs.open(target, 'r');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let newlines = 0;
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) return false;
      position += bytesRead;
      for (let i = 0; i < bytesRead; i += 1) {
        if (buffer[i] === 0x0a) {
          newlines += 1;
          if (newlines >= line - 1) return true;
        }
      }
      if (newlines >= line - 1) return true;
    }
  } finally {
    await handle.close();
  }
}

/** 单条锚点的物理校验：文件存在，且载荷给出的行号真的存在（行号缺失/0=未知则只验文件）。 */
async function validateAnchor(root: string | undefined, anchor: EvidenceAnchor): Promise<AnchorOutcome> {
  const target = path.isAbsolute(anchor.file)
    ? anchor.file
    : root
      ? path.join(root, anchor.file)
      : null;
  if (!target) return { kind: 'unchecked' };
  if (anchor.line !== null && anchor.line !== 0) {
    if (!Number.isInteger(anchor.line) || anchor.line < 0) {
      return { kind: 'line_invalid', line: anchor.line };
    }
    try {
      return (await lineExistsInFile(target, anchor.line))
        ? { kind: 'verified' }
        : { kind: 'line_out_of_range', line: anchor.line };
    } catch {
      return { kind: 'file_missing' };
    }
  }
  try {
    return (await fs.stat(target)).isFile() ? { kind: 'verified' } : { kind: 'file_missing' };
  } catch {
    return { kind: 'file_missing' };
  }
}

/** 单个载荷锚点数的校验上限——防御超大返回体拖垮出库路径。 */
const MAX_ANCHORS_CHECKED = 500;

export async function buildVerificationReceipt(options: {
  tool: string;
  value: unknown;
  /** 仓库根（repo.localPath / repoPath）；缺省时锚点只能标 UNCHECKED。 */
  root?: string;
}): Promise<VerificationReceipt> {
  const { tool, value, root } = options;
  const { anchors, breakMarkers } = extractEvidence(value);
  const receipt: VerificationReceipt = {
    engineVersion: VERSION,
    tool,
    verdict: 'NO_EVIDENCE',
    anchorsTotal: anchors.length,
    anchorsChecked: 0,
    anchorsMissing: [],
    breakMarkers,
    diagnostics: []
  };
  if (anchors.length === 0) return receipt;

  const sample = anchors.slice(0, MAX_ANCHORS_CHECKED);
  const truncated = anchors.length > sample.length;
  let unchecked = 0;
  for (const anchor of sample) {
    const outcome = await validateAnchor(root, anchor);
    if (outcome.kind === 'unchecked') {
      // v1.5.1 票 02 — 没校验到的不算 checked，也不再静默：见下面的回执级诊断。
      unchecked += 1;
      continue;
    }
    receipt.anchorsChecked += 1;
    if (outcome.kind === 'verified') continue;
    receipt.anchorsMissing.push({ path: anchor.path, file: anchor.file, line: anchor.line });
    if (outcome.kind === 'file_missing') {
      receipt.diagnostics.push({
        path: anchor.path,
        code: 'ANCHOR_FILE_MISSING',
        message: `anchor file not found on disk: ${anchor.file}`
      });
    } else if (outcome.kind === 'line_out_of_range') {
      receipt.diagnostics.push({
        path: anchor.path,
        code: 'ANCHOR_LINE_OUT_OF_RANGE',
        message: `anchor line ${outcome.line} is past the end of ${anchor.file}`
      });
    } else {
      receipt.diagnostics.push({
        path: anchor.path,
        code: 'ANCHOR_FIELD_INVALID',
        message: `anchor line is not a positive integer: ${String(outcome.line)}`
      });
    }
  }
  // 回执级诊断：环境不足与截断都不是「锚点有问题」，但都必须可见——
  // 「绝不静默交付」的前提是消费者能看见自己拿到的是部分校验。
  if (unchecked > 0) {
    receipt.diagnostics.push({
      path: 'anchors',
      code: 'ANCHORS_UNCHECKED',
      message: `${unchecked} anchor(s) skipped: no repository root available`
    });
  }
  if (truncated) {
    receipt.diagnostics.push({
      path: 'anchors',
      code: 'ANCHORS_TRUNCATED',
      message: `only the first ${sample.length} of ${anchors.length} anchors were checked`
    });
  }
  if (receipt.anchorsMissing.length > 0) {
    receipt.verdict = 'ANCHORS_MISSING';
  } else if (unchecked > 0 || truncated) {
    receipt.verdict = 'UNCHECKED';
  } else {
    receipt.verdict = 'VERIFIED';
  }
  return receipt;
}
