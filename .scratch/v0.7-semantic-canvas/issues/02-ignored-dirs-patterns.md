# 02: IGNORED_DIRS 模式化（venv 变体过滤）

Status: ready-for-agent

## 问题

`repoqa-scan.ts:38-65` 的 IGNORED_DIRS 为 26 项精确名（小写 `Set.has`），`env_py310`、`.conda`、`poetry_env` 等团队常见虚拟环境目录被完整扫描，第三方库源码混入符号库。

## 任务

1. 保留精确名单，新增模式匹配层：`venv*`/`env*` 前缀（覆盖 env_py310）与 `*env` 后缀（覆盖 poetry_env）正则；取舍原则——不误伤普通业务目录（`environments/`、`env-config/` 不命中），落地时以测试固定行为并在 Comments 记录规则。
2. `.conda` 加入精确名单。
3. 单测：`env_py310`/`poetry_env`/`.conda` 被忽略；`environments`/`envoy` 类业务目录不误伤。
4. gate 断言：fixture 放 `env_py310/` 目录含 .py，导入后其符号不出现。

## 验收

- 单测 + gate 断言双绿；匹配规则集中一处并有注释说明。

## Comments

- 2026-08-28（code-review 记录）：模式层为 `/^venv/`、`/^\.venv/`、`/^env[\d_]/`、
  `/_env$/` 四条窄规则 + 精确名单新增 `.conda` 与裸 `env`；`environments/`、
  `env-config/`、`envoy/` 均不命中（有单测固化）。
