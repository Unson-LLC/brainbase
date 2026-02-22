#!/usr/bin/env node

/**
 * リード候補に追加情報を付与してSalesTailorに同期
 *
 * 追加情報:
 * - industryCategoryName: 業界カテゴリ（company-types.jsonから）
 * - companySize: 企業規模（従業員数から推定）
 * - description: 会社説明（CSVの業務概要）
 */

import fs from 'fs';
import { parse } from 'csv-parse/sync';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.INFO_SSOT_DATABASE_URL || 'postgres://localhost/brainbase_ssot',
});

const API_KEY = process.env.SALESTAILOR_API_KEY;
const API_URL = process.env.SALESTAILOR_API_URL;

const COMPANY_TYPES_PATH = './company-types.json';
const CSV_PATH = '/Users/ksato/workspace/shared/_codex/common/meta/leads/unson/vibe_coding_targets_2025-12.csv';

if (!API_KEY || !API_URL) {
  console.error('Error: SALESTAILOR_API_KEY and SALESTAILOR_API_URL are required');
  process.exit(1);
}

/**
 * 企業タイプから業界カテゴリ名を取得
 */
function getIndustryCategoryName(companyType) {
  const mapping = {
    'saas': 'IT・通信',
    'it': 'IT・通信',
    'vc': '金融',
    'consulting': 'コンサルティング',
    'other': 'その他',
  };
  return mapping[companyType] || 'その他';
}

/**
 * 業務概要から企業規模を推定（簡易版）
 */
function estimateCompanySize(description, companyName) {
  if (!description) return 'MEDIUM'; // デフォルト

  const descLower = description.toLowerCase();
  const nameLower = companyName.toLowerCase();

  // 大企業のキーワード
  if (
    /上場|東証|nasdaq|nyse|fortune 500|グローバル/.test(description) ||
    /株式会社ntt|トヨタ|ソニー|日立|富士通|パナソニック|キヤノン/.test(companyName)
  ) {
    return 'ENTERPRISE';
  }

  // 中堅企業のキーワード
  if (/従業員.*?[0-9]{3,4}人|社員.*?[0-9]{3,4}名/.test(description)) {
    return 'LARGE';
  }

  // 小規模企業のキーワード
  if (
    /スタートアップ|ベンチャー|創業.*?年/.test(description) ||
    /従業員.*?[0-9]{1,2}人|社員.*?[0-9]{1,2}名/.test(description)
  ) {
    return 'SMALL';
  }

  return 'MEDIUM'; // デフォルト
}

/**
 * リード候補を抽出
 */
async function fetchLeads() {
  const result = await pool.query(`
    SELECT id, payload
    FROM graph_entities
    WHERE entity_type='contact'
      AND payload->>'tags' IS NOT NULL
      AND (
        payload->'tags' ? 'saas_founder'
        OR payload->'tags' ? 'saas_sales'
        OR payload->'tags' ? 'enterprise_sales'
      )
  `);

  return result.rows.map(row => ({
    id: row.id,
    ...row.payload,
  }));
}

/**
 * SalesTailor APIに送信
 */
async function syncToSalesTailor(companies, dryRun = false) {
  console.log(`Total unique companies: ${companies.length}`);

  if (dryRun) {
    console.log('\n[DRY RUN] Would send the following companies:');
    companies.slice(0, 5).forEach(c => {
      console.log(`  - ${c.canonicalName}`);
      console.log(`    URL: ${c.url || '(no url)'}`);
      console.log(`    Industry: ${c.industryCategoryName || '(no industry)'}`);
      console.log(`    Size: ${c.companySize || '(no size)'}`);
      console.log(`    Description: ${c.description ? c.description.substring(0, 100) + '...' : '(no description)'}`);
    });
    return { created: 0, updated: 0, failed: 0 };
  }

  // バッチ送信（5社ずつ）
  const BATCH_SIZE = 5;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalFailed = 0;

  for (let i = 0; i < companies.length; i += BATCH_SIZE) {
    const batch = companies.slice(i, i + BATCH_SIZE);

    console.log(`\nSending batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} companies)...`);

    try {
      const response = await fetch(`${API_URL}/companies/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({ companies: batch }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Error: ${response.status} ${response.statusText}`);
        console.error(errorText);
        totalFailed += batch.length;
        continue;
      }

      const result = await response.json();
      console.log(`  Created: ${result.created}, Updated: ${result.updated}, Failed: ${result.failed}`);

      totalCreated += result.created;
      totalUpdated += result.updated;
      totalFailed += result.failed;

    } catch (error) {
      console.error(`Failed to send batch:`, error.message);
      totalFailed += batch.length;
    }
  }

  return {
    created: totalCreated,
    updated: totalUpdated,
    failed: totalFailed,
  };
}

/**
 * メイン処理
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('Loading company types...');
  const companyTypes = JSON.parse(fs.readFileSync(COMPANY_TYPES_PATH, 'utf-8'));

  console.log('Loading CSV data...');
  const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
  const csvRecords = parse(csvContent, { columns: true, skip_empty_lines: true });

  // CSVデータをマップに変換（会社名→レコード）
  const csvMap = new Map();
  csvRecords.forEach(record => {
    csvMap.set(record['会社名'], record);
  });

  console.log('Fetching leads from Postgres...');
  const leads = await fetchLeads();
  console.log(`Total leads: ${leads.length}`);

  // 会社情報を抽出（重複排除 + 追加情報付与）
  const companiesMap = new Map();

  leads.forEach(lead => {
    const company = lead.company;
    const url = lead.url;

    if (!company || !url) return;

    if (!companiesMap.has(company)) {
      const companyTypeData = companyTypes[company];
      const csvData = csvMap.get(company);

      // 業界カテゴリ
      const industryCategoryName = companyTypeData
        ? getIndustryCategoryName(companyTypeData.type)
        : 'その他';

      // 企業規模
      const description = csvData ? csvData['業務概要'] : '';
      const companySize = estimateCompanySize(description, company);

      companiesMap.set(company, {
        canonicalName: company,
        url: url,
        industryCategoryName: industryCategoryName,
        companySize: companySize,
        description: description ? description.substring(0, 500) : undefined, // 最初の500文字
      });
    }
  });

  const companies = Array.from(companiesMap.values());

  // 統計表示
  console.log('\n=== Enriched Data Statistics ===');
  const industryCounts = {};
  const sizeCounts = {};
  companies.forEach(c => {
    industryCounts[c.industryCategoryName] = (industryCounts[c.industryCategoryName] || 0) + 1;
    sizeCounts[c.companySize] = (sizeCounts[c.companySize] || 0) + 1;
  });

  console.log('\nIndustry Distribution:');
  Object.entries(industryCounts).forEach(([industry, count]) => {
    console.log(`  ${industry}: ${count}`);
  });

  console.log('\nCompany Size Distribution:');
  Object.entries(sizeCounts).forEach(([size, count]) => {
    console.log(`  ${size}: ${count}`);
  });

  // サンプル表示
  console.log('\n=== Sample Enriched Companies (first 5) ===');
  companies.slice(0, 5).forEach(c => {
    console.log(`\n${c.canonicalName}`);
    console.log(`  URL: ${c.url}`);
    console.log(`  Industry: ${c.industryCategoryName}`);
    console.log(`  Size: ${c.companySize}`);
    console.log(`  Description: ${c.description ? c.description.substring(0, 100) + '...' : '(no description)'}`);
  });

  // SalesTailorに同期
  console.log('\n=== Syncing to SalesTailor ===');
  const result = await syncToSalesTailor(companies, dryRun);

  console.log('\n=== Summary ===');
  console.log(`Created: ${result.created}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Failed: ${result.failed}`);

  if (dryRun) {
    console.log('\n[DRY RUN] No changes made');
  }
}

main()
  .catch(console.error)
  .finally(() => pool.end());
