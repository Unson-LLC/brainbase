#!/usr/bin/env tsx

/**
 * Pre-Edit ファイル検証フック（薄いラッパー）
 *
 * core/quality/file-verifier.tsのエントリーポイント
 */

import { FileVerifier } from "../../core/quality/file-verifier";

// コマンドライン引数から取得
const toolInput = process.argv[2] || process.env.CLAUDE_TOOL_INPUT || "";

if (toolInput) {
  const verifier = new FileVerifier();
  verifier.verify(toolInput);
}
