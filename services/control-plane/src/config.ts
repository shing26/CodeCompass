import os from 'node:os';
import path from 'node:path';

export interface Config {
  port: number;
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
  const dataDir = env.MHW_DATA_DIR
    ? path.resolve(env.MHW_DATA_DIR)
    : path.join(os.homedir(), '.mhw');
  return {
    port,
    dataDir,
    wsPath: '/ws',
    dbPath: path.join(dataDir, 'mhw.db'),
    staticDir: env.MHW_STATIC_DIR
      ? path.resolve(env.MHW_STATIC_DIR)
      : undefined
  };
}
