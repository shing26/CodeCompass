# CM-03：会话标题仅时间戳，多会话不可辨识

Status: ready-for-agent
标签：CM-03 / P3 / 来源：chat-merge 终验首轮缺陷清单 QA-F-07（会话标题项；注意与复验新增 DSML 瞬态项撞号）
类别：体验优化

## 现状（88f1985 代码核实）

- `services/control-plane/src/chat/routes.ts:62`：`const title = '会话 ' + new Date().toISOString().slice(5,16).replace('T',' ')` —— 纯时间戳，未修。
- 终验实测：POST /api/chat/sessions 两次，标题分别为「会话 09-08 01:48 / 01:52」，列表中无法区分话题；无 PATCH/重命名端点（routes.ts 无 PATCH 路由）。

## 修法建议（推荐零 LLM 成本方案）

1. 默认摘要标题：首条用户消息落库时，若会话 title 仍为默认时间戳格式，用首条用户消息裁剪（前 24 字符，含 emoji 边界处理）更新 title（store 增加 `updateTitle(id, title)`）。
2. 可选增强：新增 `PATCH /api/chat/sessions/:id`（body `{title}`，≤100 字符校验）+ 前端会话侧栏重命名入口。

不建议用 LLM 生成摘要标题（额外计费调用 + 首问延迟），摘要式交给用户重命名即可。

## 验收标准

1. 新会话发出首条消息后，GET /api/chat/sessions 列表中该会话标题含首条消息摘要（≤24 字符），不再是默认时间戳格式。
2. 标题跨重启保留（SQLite 持久化）。
3. 裁剪边界单测：纯 emoji、超长单串、全空白、恰好 24 字符。
4. 若实现 PATCH：无 body title / 非法类型 → 400 JSON；未知会话 → 404 JSON（对齐现有边界风格）。

## Comments
