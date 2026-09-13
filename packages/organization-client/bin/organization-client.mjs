#!/usr/bin/env node
import { main } from '../src/index.mjs';

try {
  const result = await main();
  if (result && Number.isInteger(result.exitCode)) process.exitCode = result.exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'organization client failed');
  process.exitCode = 1;
}
