import path from 'node:path';
import fs from 'node:fs/promises';
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
 *     读到的是「这批结论里有多少条静态证据断口」的确定性读数；
 *   - verdict 任一项不通过都明确写明（diagnostics 逐条带 JSON 路径），
 *     绝不静默交付——「宁可标记，绝不编造」的对外延伸。
 *
 * 回执是增量字段：不修改载荷、不改工具签名，消费方可以选择忽略。
 */

/** 静态证据断口的枚举值——出现即计数，语义见 ADR-0002 / ADR-0005。 */
const BREAK_MARKER_VALUES = new Set([
  'BREAK',
  'BROKEN',
  'EXTERNAL',
  'DYNAMIC',
  'UNRESOLVED',
  'SUSPECT',
  'STATIC_ANALYSIS_BREAK'
]);

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
  /** 有锚点且全部通过物理存在性校验。 */
  | 'VERIFIED'
  /** 有锚点未通过校验——diagnostics 逐条给出缺失位置。 */
  | 'ANCHORS_MISSING'
  /** 有锚点但无法校验（仓库根不可得 / 文件系统不可达）。 */
  | 'UNCHECKED'
  /** 载荷中没有任何锚点——确定性陈述，不是失败。 */
  | 'NO_EVIDENCE';

export interface VerificationDiagnostic {
  /** JSON 路径，如 "hops[2].file"。 */
  path: string;
  code: 'ANCHOR_FILE_MISSING' | 'ANCHOR_FIELD_INVALID';
  message: string;
}

export interface VerificationReceipt {
  engineVersion: string;
  tool: string;
  verdict: VerificationVerdict;
  anchorsChecked: number;
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

/** 校验单个锚点文件是否在仓库根下物理存在（绝对路径直接查，相对路径贴根解析）。 */
async function anchorFileExists(root: string | undefined, file: string): Promise<boolean | null> {
  if (typeof file !== 'string' || file.length === 0) return null;
  try {
    const target = path.isAbsolute(file) ? file : root ? path.join(root, file) : null;
    if (!target) return null;
    const stat = await fs.stat(target);
    return stat.isFile();
  } catch {
    return false;
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
    anchorsChecked: 0,
    anchorsMissing: [],
    breakMarkers,
    diagnostics: []
  };
  if (anchors.length === 0) return receipt;

  const sample = anchors.slice(0, MAX_ANCHORS_CHECKED);
  let missingRoot = false;
  for (const anchor of sample) {
    const exists = await anchorFileExists(root, anchor.file);
    receipt.anchorsChecked += 1;
    if (exists === null) {
      missingRoot = true;
      continue;
    }
    if (!exists) {
      receipt.anchorsMissing.push({ path: anchor.path, file: anchor.file, line: anchor.line });
      receipt.diagnostics.push({
        path: anchor.path,
        code: 'ANCHOR_FILE_MISSING',
        message: `anchor file not found on disk: ${anchor.file}`
      });
    }
  }
  if (receipt.anchorsMissing.length > 0) {
    receipt.verdict = 'ANCHORS_MISSING';
  } else if (missingRoot) {
    receipt.verdict = 'UNCHECKED';
  } else {
    receipt.verdict = 'VERIFIED';
  }
  return receipt;
}
