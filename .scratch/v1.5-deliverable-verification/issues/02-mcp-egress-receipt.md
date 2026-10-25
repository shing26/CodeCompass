# 票 02 — registerPlain 出库挂回执

Status: done

repoqa-mcp.ts 的 registerPlain：handler 结果为对象时，在 textResult 前附加
顶层 verification 字段（buildVerificationReceipt 的结果）。root 解析：args.repoId
→ repo.localPath；get_pr_impact 用 args.repoPath；无 root 时锚点校验记 skipped。
17 个输入签名零变化。审计 hook 不变（回执在审计序列化前挂上，审计自然含回执）。
