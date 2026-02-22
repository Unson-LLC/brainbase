#!/usr/bin/env node
/**
 * Postgres contacts → SalesTailor API 同期スクリプト
 *
 * Usage:
 *   node sync.js [--dry-run] [--limit N]
 *
 * Example:
 *   node sync.js --dry-run           # 送信せずに件数確認
 *   node sync.js --limit 10          # 10件だけ送信（テスト用）
 *   node sync.js                     # 全件送信
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 環境変数を読み込み
const envPaths = [
  join(os.homedir(), 'workspace', '.env'),
  join(process.cwd(), '.env')
];

for (const envPath of envPaths) {
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

const { Client } = pg;

// 環境変数チェック
const DATABASE_URL = process.env.INFO_SSOT_DATABASE_URL;
const API_KEY = process.env.SALESTAILOR_API_KEY;
const API_URL = process.env.SALESTAILOR_API_URL || 'https://salestailor-web-unson.fly.dev/api/v1';

if (!DATABASE_URL) {
  console.error('❌ ERROR: INFO_SSOT_DATABASE_URL is not set');
  process.exit(1);
}

if (!API_KEY) {
  console.error('❌ ERROR: SALESTAILOR_API_KEY is not set');
  process.exit(1);
}

// コマンドライン引数を解析
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex !== -1 && args[limitIndex + 1] ? parseInt(args[limitIndex + 1]) : null;

/**
 * Postgresからcontactデータを取得
 */
async function fetchContacts(client, limit = null) {
  const query = `
    SELECT
      id,
      payload->>'name' as name,
      payload->>'company' as company,
      payload->>'email' as email,
      payload->>'url' as url
    FROM graph_entities
    WHERE entity_type = 'contact'
      AND payload->>'company' IS NOT NULL
      AND payload->>'company' <> ''
      AND payload->>'url' IS NOT NULL
      AND payload->>'url' <> ''
    ${limit ? `LIMIT ${limit}` : ''}
  `;

  const result = await client.query(query);
  return result.rows;
}

/**
 * URLのバリデーション（http/https プレフィックス必須）
 */
function isValidUrl(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * SalesTailor API形式に変換
 */
function transformToApiFormat(contacts) {
  const seen = new Set();
  const companies = [];

  for (const contact of contacts) {
    // URLバリデーション
    if (!isValidUrl(contact.url)) {
      console.log(`⚠️  Skipping invalid URL: ${contact.company} - ${contact.url}`);
      continue;
    }

    // 重複チェック（company名とURLの組み合わせ）
    const key = `${contact.company}|||${contact.url}`;
    if (seen.has(key)) {
      console.log(`⚠️  Skipping duplicate: ${contact.company} - ${contact.url}`);
      continue;
    }
    seen.add(key);

    companies.push({
      canonicalName: contact.company,
      url: contact.url,
    });
  }

  return companies;
}

/**
 * SalesTailor APIにバッチ送信
 */
async function sendBatch(companies, batchNumber, totalBatches) {
  const url = `${API_URL}/companies/batch`;

  console.log(`📤 Batch ${batchNumber}/${totalBatches}: Sending ${companies.length} companies...`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ companies }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`   ❌ Response status: ${response.status}`);
    console.error(`   ❌ Response body: ${errorText}`);
    console.error(`   ❌ Request payload:`, JSON.stringify({ companies }, null, 2));
    throw new Error(`API Error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  return result;
}

/**
 * メイン処理
 */
async function main() {
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    // データベース接続
    console.log('🔌 Connecting to Postgres...');
    await client.connect();
    console.log('✅ Connected to Postgres\n');

    // contactデータを取得
    console.log('📊 Fetching contacts from database...');
    const contacts = await fetchContacts(client, limit);
    console.log(`✅ Found ${contacts.length} contacts with company and URL\n`);

    if (contacts.length === 0) {
      console.log('ℹ️  No contacts to sync');
      return;
    }

    // API形式に変換
    const companies = transformToApiFormat(contacts);

    if (dryRun) {
      console.log('🔍 DRY RUN MODE - No data will be sent\n');
      console.log('Sample data (first 5):');
      companies.slice(0, 5).forEach((company, index) => {
        console.log(`  ${index + 1}. ${company.canonicalName} - ${company.url}`);
      });
      if (companies.length > 5) {
        console.log(`  ... and ${companies.length - 5} more`);
      }
      console.log(`\n💡 Run without --dry-run to actually send data`);
      return;
    }

    // バッチ送信
    console.log('🚀 Starting batch upload to SalesTailor API...\n');

    const BATCH_SIZE = 100;
    const batches = [];
    for (let i = 0; i < companies.length; i += BATCH_SIZE) {
      batches.push(companies.slice(i, i + BATCH_SIZE));
    }

    let totalCreated = 0;
    let totalUpdated = 0;
    let totalFailed = 0;

    for (let i = 0; i < batches.length; i++) {
      try {
        const result = await sendBatch(batches[i], i + 1, batches.length);
        totalCreated += result.created || 0;
        totalUpdated += result.updated || 0;
        totalFailed += result.failed || 0;

        console.log(`   ✅ Created: ${result.created}, Updated: ${result.updated}, Failed: ${result.failed}`);

        // レート制限対策: 1秒待機
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`   ❌ Batch ${i + 1} failed:`, error.message);
        totalFailed += batches[i].length;
      }
    }

    // 結果サマリー
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Sync Results');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`✅ Created:  ${totalCreated}`);
    console.log(`🔄 Updated:  ${totalUpdated}`);
    console.log(`❌ Failed:   ${totalFailed}`);
    console.log(`📈 Total:    ${companies.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('👋 Disconnected from Postgres');
  }
}

// 実行
main();
