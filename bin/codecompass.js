#!/usr/bin/env node
'use strict';

// `codecompass` — thin launcher for the bundled control-plane CLI
// (services/control-plane/dist/cli.js). Kept tiny on purpose: argument
// parsing, repo import, browser opening all live in the real CLI.
const { spawn } = require('node:child_process');
const path = require('node:path');

const cliJs = path.resolve(__dirname, '..', 'services', 'control-plane', 'dist', 'cli.js');

const child = spawn(process.execPath, [cliJs, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: true
});

child.on('error', (err) => {
  console.error(`codecompass: ${err.message}`);
  console.error(`codecompass: run "npm run build --prefix services/control-plane" first, or use "npx tsx services/control-plane/src/cli.ts"`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});