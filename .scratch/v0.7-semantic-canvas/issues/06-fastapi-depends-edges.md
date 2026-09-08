# 06: FastAPI Depends/Security 语义边

Status: ready-for-agent

## 问题

PythonAdapter `collectParams`（:96-113）只取参数名与类型注解，默认值被完全忽略；`def endpoint(db: Session = Depends(get_db))` 的依赖语义丢失，且 `Depends(...)` 命中通用 CallExpression 处理器产生指向不存在 "Depends" 符号的死调用边（`Security` 同理）。

## 任务

1. `collectParams` 解析参数默认值中的 `CallExpression`：被调名为 `Depends`/`Security`（含 `fastapi.Depends` 属性链尾段）时，提取实参（`get_db`）作为依赖目标。
2. 建立 endpoint → 依赖函数的调用边（复用现有调用边结构；method 标记为被调函数名，可加 `via: 'depends'` 语义字段——以契约最小改动为准，若加字段需同步 contracts）。
3. `Depends`/`Security` 自身不再产生死调用边（在通用处理器中按名单跳过）。
4. gate 的 Python fixture 加 `Depends(get_db)` 用例；断言 endpoint 子图/调用链可达 `get_db` 且无 "Depends" 死边。

## 验收

- 单测覆盖参数默认值提取与死边消除；gate 断言通过（依赖链进时序图）。

## Comments

- 2026-08-28：实现中发现更深一层的既有缺陷——`resolveCall` 的按名回退被
  `!call.dynamic` 拦截，而 PythonAdapter 把所有模块级裸函数调用标 `dynamic:true`，
  导致**所有** Python 模块级调用链（不止 Depends）从未被解析。修复：裸名调用是
  可静态按名解析的函数引用，置 `dynamic:false`（同文件优先 → 全局，Issue 15 消歧）。
  gate 断言 `FastAPI Depends` 三节点链（list_pets → get_db / pet_list）验证通过。
