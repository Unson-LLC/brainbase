#!/usr/bin/env node
/**
 * brainbase MCP Server Entry Point
 *
 * Usage:
 *   npx tsx src/index.ts [legacy_codex_path]
 */

import { runServer } from './server.js';

console.error(`[brainbase] Starting MCP Server...`);

runServer(process.argv[2]).catch((error) => {
  console.error('[brainbase] Fatal error:', error);
  process.exit(1);
});
