#!/usr/bin/env node
import { runMcpServer } from './server.js';

runMcpServer().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
