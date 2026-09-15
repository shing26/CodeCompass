/**
 * v0.30 去极客化票 01（grill D8③）——服务端文案哨。
 *
 * 历史空洞：copy-guard 只扫 apps/repoqa-web/src，而 worker 中文 stage label
 * （SSE 渲染进 UI）、chat 系统提示词、export 模板标题同为「会进用户眼睛」的
 * 服务端文案，零哨护——「演进推演」型前后端漂移（前端禁词、服务端在用）正是
 * 无人看管的结果。本文件把控制面文案纳入同一张黑名单（contracts
 * USER_COPY_BLACKLIST，与 web 哨共表，杜绝第二事实源）。
 *
 * 扫描面 = 渲染到 UI 的文案载体；工程结构注释（如 routes/analysis 的
 * 「图谱读侧域」）不在本战役射程，G8 终扫复核。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { USER_COPY_BLACKLIST } from '../../../packages/contracts/src/index';

// 本包构建 CJS，import.meta 不可用（typecheck 红线）；测试一律从包根执行
// （npm run test --prefix / CI matrix 同路径），cwd 即包根。
const SRC = join(process.cwd(), 'src');

/** 会进用户眼睛（或被模型复述进答案）的服务端文案文件。 */
const SERVER_COPY_FILES = [
  'chat/agent.ts', // 系统提示词——模型可复述面
  'chat/routes.ts', // chat SSE 人话出口
  'engine/repoqa-export.ts', // ONBOARDING/HTML 导出模板标题
  'ingest/repoqa-worker.ts' // 中文 stage label——SSE 直渲进 UI
];

/**
 * 待退役挂账（burn-down）：黑名单词在服务端仍有活居，由战役后段票面清零。
 * 纪律：销词必须走「文案改动与移除挂账同 commit」（D8④）——挂账项一旦不再
 * 命中真实文案，下方 meta 测试会红，逼着收口，不留僵尸豁免。
 * 拆分构造防自燃：本文件不在扫描面内，但保持与 web 哨同一词面工艺。
 */
const PENDING_RETIREMENT: readonly string[] = ['拆除' + '计划', '架构' + '指标'];

const EFFECTIVE = USER_COPY_BLACKLIST.filter((w) => !PENDING_RETIREMENT.includes(w));

function scanText(text: string, words: readonly string[]): string[] {
  const hits: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const word of words) {
      if (line.includes(word)) hits.push(`L${index + 1} 命中「${word}」`);
    }
  });
  return hits;
}

function scanServerCopy(words: readonly string[]): string[] {
  const offenders: string[] = [];
  for (const rel of SERVER_COPY_FILES) {
    const hits = scanText(readFileSync(join(SRC, rel), 'utf8'), words);
    offenders.push(...hits.map((h) => `${rel} ${h}`));
  }
  return offenders;
}

describe('server-side outbound copy guard (v0.30 ticket 01)', () => {
  it('user-visible server copy carries no blacklisted retired words', () => {
    expect(scanServerCopy(EFFECTIVE)).toEqual([]);
  });

  it('the sentinel bites: word detection works on known-live copy', () => {
    // 灵敏度自证——现文案里的挂账词若交扫描必须命中（否则哨空转）。
    const live = scanServerCopy(PENDING_RETIREMENT);
    expect(live.length).toBeGreaterThan(0);
  });

  it('burn-down: every pending word is still genuinely live in server copy', () => {
    for (const word of PENDING_RETIREMENT) {
      expect(
        scanServerCopy([word]).length,
        `「${word}」已不在服务端扫描面内——请把它从本票挂账中移除（销词同 commit 纪律）`
      ).toBeGreaterThan(0);
    }
  });

  it('burn-down tracker never masks a non-blacklist word (shared table sanity)', () => {
    // 防呆：挂账词必须是黑名单成员，否则是漂移。
    for (const word of PENDING_RETIREMENT) {
      expect(USER_COPY_BLACKLIST, `挂账词「${word}」不在黑名单`).toContain(word);
    }
  });
});
