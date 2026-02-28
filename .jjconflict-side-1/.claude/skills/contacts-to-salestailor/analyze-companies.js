#!/usr/bin/env node

/**
 * CSVの業務概要をLLMで分析して企業タイプを判定
 *
 * 企業タイプ:
 * - saas: SaaS/クラウドサービス提供企業
 * - it: IT/システム開発・セキュリティ企業
 * - vc: VC/投資企業
 * - consulting: コンサル/事業開発支援
 * - other: その他
 */

import fs from 'fs';
import { parse } from 'csv-parse/sync';
import Anthropic from '@anthropic-ai/sdk';

const CSV_PATH = '/Users/ksato/workspace/shared/_codex/common/meta/leads/unson/vibe_coding_targets_2025-12.csv';
const OUTPUT_PATH = './company-types.json';
const BATCH_SIZE = 20; // 一度に分析する企業数

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * 企業タイプを分析するプロンプト
 */
function createAnalysisPrompt(companies) {
  const companiesList = companies.map((c, i) =>
    `${i + 1}. ${c.name}\n   URL: ${c.url}\n   業務概要: ${c.description.substring(0, 500)}...`
  ).join('\n\n');

  return `以下の企業リストを分析し、各企業のタイプを判定してください。

企業タイプの定義:
- saas: SaaS/クラウドサービス提供企業（プラットフォーム、SaaS製品を提供）
- it: IT/システム開発・セキュリティ企業（受託開発、セキュリティサービス、通信インフラ）
- vc: VC/投資企業（ベンチャーキャピタル、投資ファンド）
- consulting: コンサル/事業開発支援企業（新規事業支援、イノベーション支援）
- other: その他（広告、製造、小売等）

企業リスト:
${companiesList}

各企業について、以下のJSON配列形式で回答してください:
[
  { "index": 1, "type": "saas", "confidence": "high", "reason": "AIプラットフォームを提供" },
  { "index": 2, "type": "it", "confidence": "medium", "reason": "システム開発とセキュリティサービス" }
]

confidence は high/medium/low のいずれか。
必ずJSON配列のみを返してください（説明不要）。`;
}

/**
 * Claude APIで企業タイプを分析
 */
async function analyzeCompanies(companies) {
  const prompt = createAnalysisPrompt(companies);

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = message.content[0].text;

  // JSON部分を抽出
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Failed to parse JSON response: ' + responseText);
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * メイン処理
 */
async function main() {
  console.log('Loading CSV...');
  const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
  const records = parse(csvContent, { columns: true, skip_empty_lines: true });

  console.log(`Total companies: ${records.length}`);

  // 既存の結果を読み込み（再実行時にスキップするため）
  let companyTypes = {};
  if (fs.existsSync(OUTPUT_PATH)) {
    console.log('Loading existing results...');
    companyTypes = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
  }

  // バッチ処理
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const companies = batch.map((r, idx) => ({
      index: i + idx,
      name: r['会社名'],
      url: r['URL'],
      description: r['業務概要'] || '',
    }));

    // すでに分析済みの企業をスキップ
    const unanalyzed = companies.filter(c => !companyTypes[c.name]);
    if (unanalyzed.length === 0) {
      console.log(`Batch ${i / BATCH_SIZE + 1}: Already analyzed, skipping...`);
      continue;
    }

    console.log(`\nBatch ${i / BATCH_SIZE + 1} (${i + 1}-${Math.min(i + BATCH_SIZE, records.length)}):`);
    console.log(`Analyzing ${unanalyzed.length} companies...`);

    try {
      const results = await analyzeCompanies(unanalyzed);

      // 結果をマッピング
      results.forEach((r) => {
        const company = unanalyzed[r.index - 1];
        if (!company) {
          console.warn(`Warning: Invalid index ${r.index}`);
          return;
        }

        companyTypes[company.name] = {
          url: company.url,
          type: r.type,
          confidence: r.confidence,
          reason: r.reason,
        };

        console.log(`  ${company.name}: ${r.type} (${r.confidence})`);
      });

      // 途中結果を保存
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(companyTypes, null, 2));

    } catch (error) {
      console.error(`Error analyzing batch ${i / BATCH_SIZE + 1}:`, error.message);
      // エラーが発生しても続行
    }

    // API Rate Limit対策: 少し待つ
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n=== Summary ===`);
  const types = Object.values(companyTypes);
  console.log(`Total analyzed: ${types.length}`);
  console.log(`SaaS: ${types.filter(t => t.type === 'saas').length}`);
  console.log(`IT: ${types.filter(t => t.type === 'it').length}`);
  console.log(`VC: ${types.filter(t => t.type === 'vc').length}`);
  console.log(`Consulting: ${types.filter(t => t.type === 'consulting').length}`);
  console.log(`Other: ${types.filter(t => t.type === 'other').length}`);

  console.log(`\nResults saved to: ${OUTPUT_PATH}`);
}

main().catch(console.error);
