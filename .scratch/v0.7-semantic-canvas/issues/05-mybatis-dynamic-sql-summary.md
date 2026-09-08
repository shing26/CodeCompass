# 05: MyBatis 动态标签摘要结构化

Status: ready-for-agent

## 问题

`repoqa-mapper.ts:43-51` `summarizeSql` 把注释、CDATA、所有 XML 标签替换为空格并截断 240 字符——`<choose>/<when>/<foreach>/<if>` 动态语义整体丢失（注释自证"never the resolved SQL runtime semantics"，本次不解析运行时语义，只做骨架结构化）。

## 任务

1. `summarizeSql` 前先统计动态标签出现次数，注入摘要头部标记：`[dynamic: choose×2, foreach×1, if×3] `。
2. 截断上限 240 → 1024。
3. 单测：含 `<choose>/<when>/<foreach>/<if>` 的 mapper XML 摘要含正确计数标记；无动态标签的 SQL 摘要不含标记。

## 验收

- 单测绿；动态 SQL 摘要可读性提升且不破坏现有 mapper 链路（`code://` 锚点、Inspector 展示）。
