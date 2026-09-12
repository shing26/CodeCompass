/**
 * v0.27-B R3 — 错误码契约（前端面，销 V27-12）。
 *
 * 后端五高频面（chat / gate run / import·reindex / file-raw / delta）与 R1
 * 中间件、R2 传输层共用一张稳定 code 表（权威表在 CONTEXT.md「错误码」节）。
 * 本模块负责：①`ApiError`——承载后端 `{error, code}`；②`describeError`——
 * 把 code 映射成人能照做的中文指引。规则：有码给「指引（原始错误：…）」，
 * 无码原样透出（保持既有行为，零新文案风险）。
 * 文案守门：所有 hint 必过 copy-guard 七词黑名单（errorCodes.test.ts 内置自查，
 * 词表按哨同款拆分构造防自燃）；新码先入 CONTEXT.md 表再实现。
 */

export class ApiError extends Error {
  readonly code: string | undefined;
  readonly status: number | undefined;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** code → 人类化指引（不含原始错误，由 describeError 追加）。 */
export const ERROR_COPY: Record<string, string> = {
  // —— 通用（R1 中间件 / 404 兜底 / 坏 JSON）
  not_found: '这个接口不存在（前后端版本可能不一致），刷新页面重试',
  invalid_json: '请求数据没有通过校验，请重试',
  request_error: '请求被服务端拒绝（参数不合法或体积超限）',
  internal_error: '服务内部错误，稍后重试；持续出现请查看服务日志',
  network_timeout: '本地服务没有响应——可能未启动或已挂起，确认 CodeCompass 运行中后重试',
  // —— 仓库目录 / 生命周期
  repo_not_found: '找不到这个仓库（可能已被删除），请重新选择仓库',
  repo_path_required: '先填写本地路径',
  repo_path_invalid: '这个路径不存在或不可读',
  import_failed: '导入失败：路径不可索引或索引引擎报错',
  repo_indexing_conflict: '该仓库正在索引中，等它完成后再操作',
  repo_removed_mid_index: '这个仓库在索引过程中被移除了',
  clone_url_required: '先填写 Git 仓库地址',
  clone_url_invalid: '这个 Git 地址不被允许（协议或主机不合法）',
  clone_branch_invalid: '分支名不合法',
  clone_git_failed: '克隆失败：检查网络与远端地址后重试',
  // —— 文件预览面
  file_path_required: '缺少文件路径参数',
  path_escape: '这个文件在仓库范围之外，不提供预览',
  not_indexed: '这个文件没有被索引',
  file_not_found: '文件不存在（可能已被移动或删除）',
  // —— delta / gate 面（票 14 契约家族）
  git_refs_required: '填写 base 与 head 两个 Git 引用后再运行',
  git_ref_invalid: 'Git 引用不能以「-」开头（会被 git 当作命令选项）',
  git_command_failed: 'Git 分析失败，展开「原始 git 输出」查看原因',
  policy_option_invalid: '门禁策略参数不合法（需为非负整数）',
  // —— chat 面
  unsupported_media_type: '请求格式没有被接受，刷新页面后重试',
  chat_session_not_found: '这个会话已经不在了（可能刚被清理），点「新会话」重新开始即可',
  chat_repo_required: '先选择一个仓库，再开始对话',
  chat_title_required: '会话标题不能为空',
  chat_message_required: '先输入问题再发送',
  invalid_model: '模型切换失败：该名称不存在',
  chat_run_failed: '回答中途出错（引擎或模型侧），可重新提问或点重新生成'
};

/** 把任意 error（Error/字符串/后端 ApiError/超时）翻成用户可执行的文案。 */
export function describeError(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  const code = typeof e?.code === 'string' ? e.code : undefined;
  const message =
    err instanceof Error ? err.message : typeof e?.message === 'string' ? e.message : String(err);
  const hint = code ? ERROR_COPY[code] : undefined;
  return hint ? `${hint}（原始错误：${message}）` : message;
}
