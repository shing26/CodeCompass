/**
 * Issue 10 (外部评审 C4) — the single source for HTTP error codes.
 *
 * Before this file the same 30 codes lived in three places that could fork:
 * the authoritative table in CONTEXT.md「Error Code Contract」, the frontend
 * `ERROR_COPY` keys, and `code: '<literal>'` strings scattered across ~38
 * server emission points. A code added at a throw point could bypass the doc
 * and the frontend copy entirely (the client then falls back to raw passthrough
 * — designed behavior, but the contract silently missed it).
 *
 * Enforcement after this file:
 *  - frontend → here: `ERROR_COPY: Record<ErrorCode, string>` (compile error
 *    when a contract code has no copy);
 *  - server → here: `services/control-plane/src/error-code-guard.test.ts`
 *    scans every `code: '<literal>'` in src and fails on anything outside this
 *    table (copy-guard style string-region scan — ~38 emission points have no
 *    single chokepoint, so a one-point compile fence is impossible);
 *  - here → CONTEXT.md: `errorCodes.test.ts` asserts every code appears in the
 *    doc's table, so the Markdown and the code cannot drift apart.
 *
 * `network_timeout` is client-synthesized (no HTTP response carries it); it is
 * in the contract because the frontend copy and the doc both describe it.
 * Adding a code: add it here, add its copy in the frontend map, add a row to
 * CONTEXT.md — all three steps are enforced (typecheck / tests).
 */

export const ERROR_CODES = {
  invalid_json: 'invalid_json',
  not_found: 'not_found',
  request_error: 'request_error',
  internal_error: 'internal_error',

  network_timeout: 'network_timeout',

  repo_not_found: 'repo_not_found',
  repo_path_required: 'repo_path_required',
  repo_path_invalid: 'repo_path_invalid',
  import_failed: 'import_failed',
  repo_indexing_conflict: 'repo_indexing_conflict',
  repo_removed_mid_index: 'repo_removed_mid_index',

  clone_url_required: 'clone_url_required',
  clone_url_invalid: 'clone_url_invalid',
  clone_branch_invalid: 'clone_branch_invalid',
  clone_git_failed: 'clone_git_failed',

  file_path_required: 'file_path_required',
  path_escape: 'path_escape',
  not_indexed: 'not_indexed',
  file_not_found: 'file_not_found',

  git_refs_required: 'git_refs_required',
  git_ref_invalid: 'git_ref_invalid',
  git_command_failed: 'git_command_failed',
  policy_option_invalid: 'policy_option_invalid',

  unsupported_media_type: 'unsupported_media_type',
  chat_session_not_found: 'chat_session_not_found',
  chat_repo_required: 'chat_repo_required',
  chat_title_required: 'chat_title_required',
  chat_message_required: 'chat_message_required',
  invalid_model: 'invalid_model',
  chat_run_failed: 'chat_run_failed'
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Runtime list derived from the table — what the guard tests scan against. */
export const ERROR_CODE_LIST: readonly ErrorCode[] = Object.keys(ERROR_CODES) as ErrorCode[];
