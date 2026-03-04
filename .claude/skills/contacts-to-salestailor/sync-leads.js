#!/usr/bin/env node

/**
 * SalesTailorのリード候補（saas_founder/saas_sales/enterprise_sales）をAPIに同期
 *
 * ステップ:
 * 1. Postgresからリード候補を抽出（タグでフィルタ）
 * 2. SalesTailor APIに送信
 * 3. relationshipStatus: "PROSPECT"を設定（将来実装）
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.INFO_SSOT_DATABASE_URL || 'postgres://localhost/brainbase_ssot',
});

const API_KEY = process.env.SALESTAILOR_API_KEY;
const API_URL = process.env.SALESTAILOR_API_URL;

if (!API_KEY || !API_URL) {
  console.error('Error: SALESTAILOR_API_KEY and SALESTAILOR_API_URL are required');
  process.exit(1);
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
async function syncToSalesTailor(leads, dryRun = false) {
  // 会社情報を抽出（重複排除）
  const companies = new Map();

  leads.forEach(lead => {
    const company = lead.company;
    const url = lead.url;

    if (!company || !url) return;

    if (!companies.has(company)) {
      companies.set(company, {
        canonicalName: company,
        url: url,
      });
    }
  });

  const companiesArray = Array.from(companies.values());
  console.log(`Total unique companies: ${companiesArray.length}`);

  if (dryRun) {
    console.log('\n[DRY RUN] Would send the following companies:');
    companiesArray.slice(0, 10).forEach(c => {
      console.log(`  - ${c.canonicalName} (${c.url})`);
    });
    return { created: 0, updated: 0, failed: 0 };
  }

  // バッチ送信（5社ずつ、デバッグ用）
  const BATCH_SIZE = 5;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalFailed = 0;

  for (let i = 0; i < companiesArray.length; i += BATCH_SIZE) {
    const batch = companiesArray.slice(i, i + BATCH_SIZE);

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

  console.log('Fetching leads from Postgres...');
  const leads = await fetchLeads();

  console.log(`Total leads: ${leads.length}`);

  // タグ統計
  const tagCounts = {};
  leads.forEach(lead => {
    const tags = lead.tags || [];
    tags.forEach(tag => {
      if (['saas_founder', 'saas_sales', 'enterprise_sales'].includes(tag)) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    });
  });

  console.log('\n=== Lead Tag Statistics ===');
  Object.entries(tagCounts).forEach(([tag, count]) => {
    console.log(`  ${tag}: ${count}`);
  });

  // サンプル表示
  console.log('\n=== Sample Leads (first 10) ===');
  leads.slice(0, 10).forEach(lead => {
    console.log(`  ${lead.name || '(no name)'} / ${lead.company}`);
    console.log(`    Role: ${lead.role || '(no role)'}`);
    console.log(`    Tags: ${(lead.tags || []).join(', ')}`);
  });

  // SalesTailorに同期
  console.log('\n=== Syncing to SalesTailor ===');
  const result = await syncToSalesTailor(leads, dryRun);

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
