#!/usr/bin/env node
/**
 * brainbase MCP Server Entry Point
 *
 * Usage:
 *   npx tsx src/index.ts [codex_path]
 *
 * If codex_path is not provided, defaults to:
 *   - CODEX_PATH environment variable, or
 *   - /Users/ksato/workspace/_codex
 */
import { runServer } from './server.js';
import { resolve } from 'path';
// Get codex path from args, env, or default
const codexPath = process.argv[2]
    || process.env.CODEX_PATH
    || '/Users/ksato/workspace/_codex';
const resolvedPath = resolve(codexPath);
console.error(`[brainbase] Starting MCP Server...`);
console.error(`[brainbase] Codex path: ${resolvedPath}`);
runServer(resolvedPath).catch((error) => {
    console.error('[brainbase] Fatal error:', error);
    process.exit(1);
});
