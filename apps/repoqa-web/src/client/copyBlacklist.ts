/**
 * v0.27-B R3（review P2-2）—— 文案黑名单 web 侧桥接。
 *
 * v0.30 票 01（D8）：词表权威升格到 packages/contracts/src/copy-blacklist.ts，
 * web copy-guard 与 control-plane 服务端哨共读一张表（本桥再导出 COPY_BLACKLIST
 * 原名，errorCodes 自查消费者零改动）。
 * 本文件被 copy-guard 全文扫描——不写任何词面字量，只 re-export。
 */
export { USER_COPY_BLACKLIST as COPY_BLACKLIST } from '../../../../packages/contracts/src/index';
