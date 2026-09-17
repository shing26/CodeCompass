// V27-25 (A2) — single source of truth for the product version string.
// Pinned by the e2e gate (closeout_gate.py check_versions): root package.json
// == this constant == CHANGELOG top entry, and the /health payload echoes it.
// Do not re-hardcode the version anywhere else — import from here instead
// (server.ts must not reach into cli.ts for it: cli.ts already imports server.ts).
export const VERSION = '0.31.0';
