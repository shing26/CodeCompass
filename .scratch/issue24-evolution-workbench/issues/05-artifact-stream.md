# Ticket 24.5 — Artifact Stream 会话形态

## 目标
Intent→Artifact 的载体(ADR-0012):工件卡时间线,(repoId, commit) 隔离,追问 = 新意图投递。

## 改动点
- 前端会话状态:`useEvolutionSession` 或扩展 `useChat`:消息结构改为工件卡序列(每卡:意图回显 + 四段产物 + provenance/usage 元信息);
- 隔离:按 `repoId + commit`(dirty → commit+dirty)分桶;仓库切换或 commit 变化即切换/开新流,不混存;
- 追问:对既有卡的后续输入作为新意图投递,新卡入同一流;
- v1 存储:前端内存(+sessionStorage 可选);服务端持久化归 Issue 25。

## 验收
- 切换仓库后流不串;同仓库 re-index(commit 变化)后开新流;
- 组件测试:投递→卡入流→追问→第二卡入流,顺序与隔离断言。


## 实施记录(Ticket 05 — done @ feat/artifact-stream 55f6bde)
- 分支:feat/artifact-stream(自合并后的 master eec7a73),独立 worktree D:/CodeCompass-artifact-stream。主树被 v0.18.0-robustness 会话占用(未提交 WIP 持续增长),全程未动主树;master 以 `git fetch . feat/evolution-view:master` 不切分支快进至 eec7a73 落袋。
- 新增 hooks/useEvolutionSession.ts:App 层会话 hook(同 useChat 惯例,切 tab 不丢)。EvolutionCard{id,intent,target,status,stages,echo,result,mermaid,commit,error,conflict};bucketsRef Map<bucketKey, cards>;bucketKey = `repoId::commit`(commit 取 Repo.commit,后端 ADR-0010 已编码 hash/hash+dirty/unversioned,天然满足 dirty→commit+dirty);bucket 切换=旧桶持久化(中断卡标 error "会话已切换,推演中断")+ 取消 in-flight 流 + 载入新桶;keyRef 守卫使 catalog 刷新(对象重建、commit 不变)不触发切桶。
- EvolutionView.tsx 改为工件流时间线 presenter:props {repo, session, onNavigate};卡片=折叠摘要行(状态标 ✓/◌/⚠ + 意图 + 🎯 锚点)+ 展开体(echo/阶段/冲突/四卡/图/清单);历史卡默认折叠、最新卡默认展开,手工展开状态记忆;追问输入框占位文案随流状态切换("继续追问…"),提交后清空输入;备选(_correction pill_)点击=submit(card.intent, alt) 追加新卡(不再覆盖重跑);header 显示 @ commit 与卡数。
- App.tsx:useEvolutionSession(client, currentRepo) 挂载并传 session。
- types.ts:Repo 补 `commit?: string` 声明(后端 mapRepo 早已返回,前端此前漏收)。
- v1 存储纯前端内存(sessionStorage 未做,spec 标注可选);服务端持久化归 Issue 25。卡片 provenance=parsedBy(llm/fallback)+commit(服务端 usage/token 未随 evolve payload 提供,未虚构字段)。
- 测试:EvolutionView.test.tsx 重写为 SessionHost 真实 hook 注入,9/9:首投递+追问第二卡(顺序/折叠断言)、切仓隔离不串+回切桶还在、re-index commit 变化开新流、in-flight 切流中断标记、备选重投追加卡、冲突卡+恢复、DEPRECATE 死代码、折叠/展开、空态。
- 验证:web typecheck ✓ / vitest 280/280 / build ✓;contracts tsc ✓;control-plane 522/522 回归;gate 38/38(worktree 内,dist 全新构建)。
- 坑位:①模块级 nextCardId 跨测试累加 → toggle testid 用 slice(-1) 会碰撞,改为统一 evolve-card-toggle + 位置取用;②会话语义下提交后清空输入 → 旧"结束后按钮可用"断言失效,改为"输入新意图后可用";③CRLF 文件多行编辑用 patch_file.py(LF 归一匹配/按原换行回写)。
