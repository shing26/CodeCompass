import { startServer } from './server';

// Control Plane standalone entry: one-process full stack. When the built SPA
// (apps/repoqa-web/dist) is present it is served on the same port as well.
void startServer().then(({ port }) => {
  console.log(`Control Plane running on http://localhost:${port}`);
});