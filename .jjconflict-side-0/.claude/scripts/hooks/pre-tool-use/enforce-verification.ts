#!/usr/bin/env npx tsx

/**
 * 実証ベース検証強制フック（薄いラッパー）
 *
 * core/verification/verification-enforcer.tsのエントリーポイント
 */

import { VerificationEnforcer } from "../../core/verification/verification-enforcer";

function main() {
  const input = process.env.CLAUDE_TOOL_INPUT || "";
  const userPrompt = process.env.CLAUDE_USER_PROMPT || "";
  const toolName = process.env.CLAUDE_TOOL_NAME || "";

  const enforcer = new VerificationEnforcer();
  enforcer.enforce(input, userPrompt, toolName);
}

// ESM compatible execution check
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
