import { startServer } from './server';
import { displayHost } from './config';

// Control Plane standalone entry: one-process full stack. When the built SPA
// (apps/repoqa-web/dist) is present it is served on the same port as well.
void startServer().then(({ port, config }) => {
  // R4 (V27-1)：打印实际绑定面（默认 127.0.0.1）；共享 displayHost（P2-3b）。
  console.log(`Control Plane running on http://${displayHost(config.host)}:${port}`);
});
