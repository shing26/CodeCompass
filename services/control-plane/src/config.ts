import os from 'node:os';
import path from 'node:path';

export interface Config {
  port: number;
  /** v0.27-B R4 (V27-1)：绑定地址。控制面零鉴权，历史上无 host listen =
   * 默认全网卡可达（LAN 暴露面）。现默认回环；LAN 展示场景用
   * `MHW_CP_HOST=0.0.0.0` 显式逃生（启动日志会告警）。 */
  host: string;
  dataDir: string;
  wsPath: string;
  dbPath: string;
  /** Absolute path to the built SPA (apps/repoqa-web/dist) for single-process
   * serving; undefined disables static hosting entirely. */
  staticDir?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsedPort = Number(env.MHW_CP_PORT);
  const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 43110;
  const host =
    env.MHW_CP_HOST && env.MHW_CP_HOST.trim() !== '' ? env.MHW_CP_HOST.trim() : '127.0.0.1';
  const dataDir = env.MHW_DATA_DIR
    ? path.resolve(env.MHW_DATA_DIR)
    : path.join(os.homedir(), '.mhw');
  return {
    port,
    host,
    dataDir,
    wsPath: '/ws',
    dbPath: path.join(dataDir, 'mhw.db'),
    staticDir: env.MHW_STATIC_DIR
      ? path.resolve(env.MHW_STATIC_DIR)
      : undefined
  };
}

/** R4 review P2-3(b)：CLI/index/启动日志共用的展示 host 规则——
 * '0.0.0.0'/'::'/空串是不可连地址，退回 'localhost' 展示；其余绑定面
 * （默认 127.0.0.1）原样展示，保证「打印的 URL」与「可达地址」永不脱节。 */
export function displayHost(bound: string): string {
  return bound === '0.0.0.0' || bound === '::' || bound === '' ? 'localhost' : bound;
}

/** R4 review P2-3(a)：回环判定基于解析后的实际监听地址而非配置字符串——
 * `127.0.0.2` 仍属回环（消除误报告警），而 hosts 把 `localhost` 重定向到
 * 路由网卡时也会如实告警（堵住理论漏报口）。 */
export function isLoopbackListenAddress(
  address: string | undefined,
  family: string | undefined
): boolean {
  if (!address) return false;
  if (family === 'IPv6') {
    return address === '::1' || address === '0:0:0:0:0:0:0:1';
  }
  return address.startsWith('127.');
}
