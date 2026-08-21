# 07 - Secret masking

**What to build:** Protect secrets before they reach any LLM call or rendered output, with unit-tested masking and regression coverage.

**Blocked by:** 04 - SSE query skeleton; 06 - Chunks and config evidence

**Status:** ready-for-human

- [x] Passwords, tokens, API keys, AK/SK, and private keys are masked before LLM context and rendering
- [x] Masking has unit tests plus HTTP-level regression tests
- [x] Masked context emits a local evidence event
- [x] Config answers never render values or local absolute paths

## Comments

### 2026-08-20 implementation

- 新增 `repoqa-masking.ts`，对 password/token/api key/AK-SK/Bearer/private key 做确定性 mask。
- `extractChunks` 在落库前 mask README/docstring，`queryRepo` 对 answer 再做一次 mask；config symbol 仍只保留 key/file/line。
- 当 chunk 原文与 mask 后不同，写入 `repoqa_events(event_type=masking.applied)`。
- 测试：新增 1 条纯 unit masking、1 条 HTTP chunk/config 不泄露 value 的回归，并断言 masking evidence event；控制平面 13 条测试全通过，typecheck 通过。

### 2026-08-20 code review fix

- masking 增加 generic `AK/SK`、`access_key_id`、`secret_access_key`、`client_secret`、`app_secret` 模式；unit test 已扩展覆盖并断言不泄露裸值。
