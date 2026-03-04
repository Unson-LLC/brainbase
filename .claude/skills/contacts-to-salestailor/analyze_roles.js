import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.INFO_SSOT_DATABASE_URL || 'postgres://localhost/brainbase_ssot'
});

await client.connect();

// 役職のサンプルを取得
const result = await client.query(`
  SELECT 
    payload->>'role' as role,
    payload->>'company' as company,
    COUNT(*) as count
  FROM graph_entities 
  WHERE entity_type='contact' 
    AND payload->>'role' IS NOT NULL
    AND payload->>'role' != ''
  GROUP BY payload->>'role', payload->>'company'
  ORDER BY count DESC
  LIMIT 50
`);

console.log('=== 頻出役職 Top 50 ===\n');
result.rows.forEach((row, i) => {
  console.log(`${i+1}. ${row.role} (${row.count}件) - ${row.company || '（会社名なし）'}`);
});

// 統計
const stats = await client.query(`
  SELECT 
    COUNT(*) as total_contacts,
    COUNT(CASE WHEN payload->>'role' IS NOT NULL AND payload->>'role' != '' THEN 1 END) as with_role,
    COUNT(CASE WHEN payload->>'company' IS NOT NULL AND payload->>'company' != '' THEN 1 END) as with_company
  FROM graph_entities 
  WHERE entity_type='contact'
`);

console.log('\n=== 統計 ===');
console.log(`総contact数: ${stats.rows[0].total_contacts}`);
console.log(`役職あり: ${stats.rows[0].with_role} (${(stats.rows[0].with_role/stats.rows[0].total_contacts*100).toFixed(1)}%)`);
console.log(`会社名あり: ${stats.rows[0].with_company} (${(stats.rows[0].with_company/stats.rows[0].total_contacts*100).toFixed(1)}%)`);

await client.end();
