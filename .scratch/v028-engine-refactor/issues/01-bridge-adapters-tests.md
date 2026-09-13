# 01：B1 — bridge-adapters 最小单测（销 V27-28）

> *Parent spec：`.scratch/v028-engine-refactor/spec.md`（grill D5/D7）。*

Status: closed
标签：test / P2 / 来源：2026-09-14 全模块验证——该包唯一防线是 tsc；消费方 harness-manager 仅被 control-plane HTTP 测试间接覆盖，适配器行为回归无直接防线。

## Agent Brief

**Summary:** 包内 vitest devDep + `test` 脚本；`adapters.test.ts` 覆盖 stub/coding/browser（生命周期转换、成功事件序列 logs→token→done、取消短路、细节行为）与 shell（真实子进程：stdout 流、退出码映射、缺 command 快败、不可解析命令失败、cancel kill、disconnect 清态）。零 token 零外网。接线：根 `test:bridge` 脚本 + ci.yml matrix 步骤。

**Acceptance:** 26 例全绿（本地已验）；三平台 CI 绿（shell 用例跨平台设计：echo/exit 7/ping 双分支）。

## Comments（2026-09-14 实施收口）

- 落地：vitest@^3.2.7（对齐 web 线，Node 24 兼容）；测试首版即抓到自己的断言错（status 是方法非属性——`typeof a.status()`），修后 26/26。
- **按现状钉死而非「顺手修」的契约**：`StubAdapter.type === 'shell'`（HarnessType 联合无 'stub' 值，且全仓零消费者——`grep StubAdapter` 仅自导出；用例注明是 pin 非 bug）。另：三个模拟适配器的 `sleepCancellable` 三副本重复，属票 03 结构面的合并候选，本票不动行为。
- shell 取消用例注释记录跨平台陷阱：kill 只杀 shell 包装、孙进程可能持 stdio 管道拖 close 事件——断言用 Promise.race 观察「无 done」而非无条件 await submit。
- 首跑即全绿于本地；跨平台裁决交 CI matrix（win/ubuntu/macos 各跑一次）。
