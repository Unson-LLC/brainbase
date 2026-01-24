// Node.js 18+ のネイティブ fetch を使用
// シップテーブル作成スクリプト（全11ベース対応）
// Usage: NOCODB_API_TOKEN=xxx node scripts/setup-ships-table.js

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const NOCODB_API_TOKEN = process.env.NOCODB_API_TOKEN;

if (!NOCODB_API_TOKEN) {
  console.error('Error: NOCODB_API_TOKEN is required');
  process.exit(1);
}

// 対象ベース一覧
const BASES = [
  { id: 'pqj22ze3jh0mkms', name: 'BAAO' },
  { id: 'ptykrgx40t36l9y', name: 'DialogAI' },
  { id: 'p95wu69gwchz94m', name: 'NCOM' },
  { id: 'pqot58neiu3o1xo', name: 'SalesTailor' },
  { id: 'p0f59uaty8zr8yd', name: 'Senrigan' },
  { id: 'p8gn2zt3k3bhia3', name: 'Mywa' },
  { id: 'pr8u5q4qnb8op11', name: 'Zeims' },
  { id: 'pypw36aox9nkhb6', name: 'BackOffice' },
  { id: 'pva7l2qlu6fdfip', name: 'Brainbase' },
  { id: 'p3tzrrtqi5hm40t', name: 'Tech Knight' },
  { id: 'pfgza5aei6wboaq', name: 'VibePro' },
];

// 削除対象: 既存の統合Shipsテーブル
const OLD_SHIPS_TABLE_ID = 'mibhb2xeahc9z7s';

const SHIP_TYPE_OPTIONS = 'feature_released,improvement_released,bugfix_released,message_type_deployed,campaign_delivered,maintenance_resolved,sales_material_delivered,invoice_sent,vendor_paid,expense_reimbursed,month_close_done,contract_executed,tax_filed';
const STATUS_OPTIONS = 'planned,in_progress,in_review,shipped,verified';

async function deleteOldShipsTable() {
  console.log(`\n--- 既存Shipsテーブル削除 (ID: ${OLD_SHIPS_TABLE_ID}) ---`);
  const url = `${NOCODB_BASE_URL}/api/v1/db/meta/tables/${OLD_SHIPS_TABLE_ID}`;

  const response = await fetch(url, {
    method: 'DELETE',
    headers: { 'xc-token': NOCODB_API_TOKEN },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 404) {
      console.log('  → テーブルが見つかりません（既に削除済み）。スキップします。');
      return;
    }
    throw new Error(`削除失敗: ${response.status} - ${errorBody}`);
  }

  console.log('  → 削除完了');
}

async function createShipsTable(base) {
  const url = `${NOCODB_BASE_URL}/api/v1/db/meta/projects/${base.id}/tables`;

  const payload = {
    table_name: 'シップ',
    title: 'シップ',
    columns: [
      { column_name: 'id', title: 'ID', uidt: 'ID', pk: true, ai: true },
      { column_name: 'title', title: 'タイトル', uidt: 'SingleLineText', rqd: true },
      { column_name: 'ship_type', title: 'Ship種別', uidt: 'SingleSelect', rqd: true, dtxp: SHIP_TYPE_OPTIONS },
      { column_name: 'status', title: 'ステータス', uidt: 'SingleSelect', rqd: true, dtxp: STATUS_OPTIONS },
      { column_name: 'owner', title: '担当者', uidt: 'SingleLineText', rqd: false },
      { column_name: 'shipped_at', title: '出荷日', uidt: 'DateTime', rqd: false },
      { column_name: 'external_ref_url', title: '証跡URL', uidt: 'SingleLineText', rqd: false },
      { column_name: 'description', title: '説明', uidt: 'LongText', rqd: false },
      { column_name: 'counterparty', title: '相手先', uidt: 'SingleLineText', rqd: false },
      { column_name: 'amount', title: '金額', uidt: 'Number', rqd: false },
      { column_name: 'sprint_week', title: 'Sprint週', uidt: 'SingleLineText', rqd: false },
      { column_name: 'created_at', title: '作成日', uidt: 'DateTime', rqd: true },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xc-token': NOCODB_API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`${base.name}: テーブル作成失敗 ${response.status} - ${errorBody}`);
  }

  const result = await response.json();
  return result;
}

async function main() {
  console.log('=== シップテーブルセットアップ ===\n');

  // Step 1: 既存テーブル削除
  await deleteOldShipsTable();

  // Step 2: 全ベースにテーブル作成
  console.log('\n--- 各ベースにシップテーブルを作成 ---\n');

  const results = [];
  for (const base of BASES) {
    try {
      const result = await createShipsTable(base);
      console.log(`  ✓ ${base.name} (${base.id}) → Table ID: ${result.id}`);
      results.push({ base: base.name, tableId: result.id, success: true });
    } catch (err) {
      console.error(`  ✗ ${base.name} (${base.id}) → ${err.message}`);
      results.push({ base: base.name, error: err.message, success: false });
    }
  }

  // サマリー
  console.log('\n--- サマリー ---');
  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  console.log(`  成功: ${succeeded.length}/${BASES.length}`);
  if (failed.length > 0) {
    console.log(`  失敗: ${failed.map(f => f.base).join(', ')}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
