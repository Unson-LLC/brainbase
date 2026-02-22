#!/usr/bin/env node

/**
 * graph_entitiesテーブルのスキーマとサンプルデータを確認
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.INFO_SSOT_DATABASE_URL || 'postgres://localhost/brainbase_ssot',
});

async function main() {
  try {
    // スキーマ確認
    console.log('=== graph_entities schema ===');
    const schemaResult = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'graph_entities'
      ORDER BY ordinal_position;
    `);
    console.table(schemaResult.rows);

    // サンプルデータ確認（タグあり）
    console.log('\n=== Sample contacts with tags ===');
    const sampleWithTags = await pool.query(`
      SELECT id, entity_type, payload->>'name' as name, payload->>'company' as company, payload->>'tags' as tags
      FROM graph_entities
      WHERE entity_type='contact' AND payload->>'tags' IS NOT NULL
      LIMIT 5;
    `);
    console.table(sampleWithTags.rows);

    // サンプルデータ確認（タグなし）
    console.log('\n=== Sample contacts without tags ===');
    const sampleWithoutTags = await pool.query(`
      SELECT id, entity_type, payload->>'name' as name, payload->>'company' as company, payload->>'role' as role
      FROM graph_entities
      WHERE entity_type='contact' AND payload->>'tags' IS NULL
      LIMIT 10;
    `);
    console.table(sampleWithoutTags.rows);

    // 統計
    console.log('\n=== Statistics ===');
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total_contacts,
        COUNT(payload->>'tags') as contacts_with_tags,
        COUNT(*) - COUNT(payload->>'tags') as contacts_without_tags
      FROM graph_entities
      WHERE entity_type='contact';
    `);
    console.table(stats.rows);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
