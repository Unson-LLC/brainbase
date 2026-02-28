#!/usr/bin/env tsx

/**
 * 技術者思考強制フック（薄いラッパー）
 *
 * core/quality/technical-engineer-verifier.tsのエントリーポイント
 */

import { TechnicalEngineerVerifier } from "../../core/quality/technical-engineer-verifier";

// メイン実行
const toolInput = process.argv[2] || process.env.CLAUDE_TOOL_INPUT || "";

const verifier = new TechnicalEngineerVerifier();
verifier.verify(toolInput);
