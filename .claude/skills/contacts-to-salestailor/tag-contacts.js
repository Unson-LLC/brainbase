#!/usr/bin/env node

/**
 * Postgresのcontactsにタグを付与
 *
 * ロジック:
 * 1. company-types.jsonから企業タイプを読み込み
 * 2. Postgresからcontacts取得
 * 3. 企業タイプ × 役職 でタグを決定:
 *    - SaaS企業 × 経営者/創業者 → saas_founder, ind_saas, role_cxo
 *    - SaaS企業 × 営業責任者 → saas_sales, ind_saas, role_vp/director
 *    - IT企業 × 営業担当 → enterprise_sales, ind_saas, role_manager/staff
 * 4. 全員に関係性レベル exchanged（レベル0）を付与
 * 5. Postgresを更新（payload.tags）
 */

import fs from 'fs';
import pg from 'pg';
const { Pool } = pg;

const COMPANY_TYPES_PATH = './company-types.json';

const pool = new Pool({
  connectionString: process.env.INFO_SSOT_DATABASE_URL || 'postgres://localhost/brainbase_ssot',
});

/**
 * 役職から役職レベルを判定
 */
function getRoleLevel(role) {
  if (!role) return null;

  const roleLower = role.toLowerCase();

  // CxO
  if (/ceo|cto|cfo|coo|cmo|cio|founder|創業者|社長|代表取締役/.test(roleLower)) {
    return 'role_cxo';
  }

  // VP / 本部長
  if (/vp|vice president|本部長|執行役員/.test(roleLower)) {
    return 'role_vp';
  }

  // 部長 / Director
  if (/部長|director|head of/.test(roleLower)) {
    return 'role_director';
  }

  // 課長 / Manager
  if (/課長|manager|chief|マネージャー/.test(roleLower)) {
    return 'role_manager';
  }

  // 担当者
  return 'role_staff';
}

/**
 * 役職から業務適合性タグを判定
 */
function getBusinessFitTags(companyType, role) {
  if (!role || !companyType) return [];

  const roleLower = role.toLowerCase();

  // SaaS企業の場合
  if (companyType === 'saas') {
    // 経営者/創業者
    if (/ceo|cto|founder|創業者|社長|代表取締役/.test(roleLower)) {
      return ['saas_founder'];
    }

    // 営業責任者
    if (/sales|営業|セールス/.test(roleLower)) {
      if (/vp|部長|director|head|chief/.test(roleLower)) {
        return ['saas_sales'];
      }
      // 営業担当者
      return ['enterprise_sales'];
    }

    // その他の役職でもSaaS企業なので saas_founder として扱う（経営陣の可能性）
    if (/coo|cfo|cmo|cio|執行役員|本部長/.test(roleLower)) {
      return ['saas_founder'];
    }
  }

  // IT企業の場合
  if (companyType === 'it') {
    // 営業担当（IT企業の営業はエンタープライズ営業として扱う）
    if (/sales|営業|セールス/.test(roleLower)) {
      return ['enterprise_sales'];
    }
  }

  return [];
}

/**
 * 企業タイプから業界タグを取得
 */
function getIndustryTag(companyType) {
  if (companyType === 'saas' || companyType === 'it') {
    return 'ind_saas';
  }
  if (companyType === 'vc') {
    return null; // VCは ind_finance を付けない（投資家セグメントとして別扱い）
  }
  if (companyType === 'consulting') {
    return 'ind_consulting';
  }
  return 'ind_other';
}

/**
 * タグ付けロジック
 */
function generateTags(companyType, role) {
  const tags = [];

  // 1. 業務適合性タグ
  const businessFitTags = getBusinessFitTags(companyType, role);
  tags.push(...businessFitTags);

  // 2. 関係性レベル（全員 exchanged = レベル0）
  tags.push('exchanged');

  // 3. 業界タグ
  const industryTag = getIndustryTag(companyType);
  if (industryTag) {
    tags.push(industryTag);
  }

  // 4. 役職レベルタグ
  const roleLevel = getRoleLevel(role);
  if (roleLevel) {
    tags.push(roleLevel);
  }

  return tags;
}

/**
 * メイン処理
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('Loading company types...');
  if (!fs.existsSync(COMPANY_TYPES_PATH)) {
    console.error(`Error: ${COMPANY_TYPES_PATH} not found`);
    console.error('Please run analyze-companies.js first');
    process.exit(1);
  }

  const companyTypes = JSON.parse(fs.readFileSync(COMPANY_TYPES_PATH, 'utf-8'));
  console.log(`Loaded ${Object.keys(companyTypes).length} company types`);

  console.log('\nFetching contacts from Postgres...');
  const result = await pool.query(`
    SELECT id, entity_type, payload
    FROM graph_entities
    WHERE entity_type='contact'
  `);

  console.log(`Total contacts: ${result.rows.length}`);

  let tagged = 0;
  let skipped = 0;
  const updates = [];

  for (const row of result.rows) {
    const payload = row.payload;
    const company = payload.company;
    const role = payload.role;

    // 会社名が空 or company-types.jsonにない場合はスキップ
    if (!company || !companyTypes[company]) {
      skipped++;
      continue;
    }

    const companyType = companyTypes[company].type;

    // タグを生成
    const tags = generateTags(companyType, role);

    if (tags.length === 0) {
      skipped++;
      continue;
    }

    // payload.tags を追加
    const updatedPayload = {
      ...payload,
      tags: tags,
    };

    updates.push({
      id: row.id,
      payload: updatedPayload,
      tags: tags,
      company: company,
      role: role,
      companyType: companyType,
    });

    tagged++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Tagged: ${tagged}`);
  console.log(`Skipped: ${skipped} (no company or not in company-types.json)`);

  // タグ統計
  const tagCounts = {};
  updates.forEach(u => {
    u.tags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  console.log(`\n=== Tag Statistics ===`);
  Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).forEach(([tag, count]) => {
    console.log(`  ${tag}: ${count}`);
  });

  // サンプル表示
  console.log(`\n=== Sample Tagged Contacts (first 10) ===`);
  updates.slice(0, 10).forEach(u => {
    console.log(`  ${u.company} / ${u.role || '(no role)'}`);
    console.log(`    Type: ${u.companyType}`);
    console.log(`    Tags: ${u.tags.join(', ')}`);
  });

  if (dryRun) {
    console.log('\n[DRY RUN] No changes made to database');
    return;
  }

  // Postgres更新
  console.log(`\nUpdating ${updates.length} contacts in Postgres...`);
  let updated = 0;

  for (const u of updates) {
    try {
      await pool.query(
        `UPDATE graph_entities SET payload = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(u.payload), u.id]
      );
      updated++;

      if (updated % 100 === 0) {
        console.log(`  Updated ${updated}/${updates.length}...`);
      }
    } catch (error) {
      console.error(`Failed to update ${u.id}:`, error.message);
    }
  }

  console.log(`\n✅ Successfully updated ${updated} contacts`);
}

main()
  .catch(console.error)
  .finally(() => pool.end());
