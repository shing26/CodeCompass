# 04: 复制 Agent 上下文脱敏 Toast

Status: ready-for-agent

## 问题

TopBar 与 Inspector 两处"复制 Agent 上下文"成功后无脱敏告知（仅 TopBar 按钮文字短暂变"已复制"），用户误以为密钥值被数据丢损。前端无 Toast 体系。

## 任务

1. 新建轻量 Toast 组件：底部居中浮层，2.5s 自动消失，主题 token 样式（border-line/bg-surface/text-success），`data-testid="copy-masking-toast"`。
2. 两个复制入口（TopBar、Inspector 的 handleCopyAgentContext）成功后触发；文案："已复制 Agent 上下文（凭据已按 13 规则脱敏，不含真实密钥值）"。
3. App 级单例 state 挂载（双入口共享，不各挂一套）；组件测试覆盖触发与自动消失。

## 验收

- 组件测试：复制后 toast 出现且文案含"脱敏"，2.5s 后消失；两入口均触发。
