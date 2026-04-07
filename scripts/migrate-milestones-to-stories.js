// マイルストーンテーブル → Story統一モデル マイグレーション
// 全ベースのマイルストーンテーブルに story_id, horizon, view, period, started_at, due_at カラムを追加
// 既存ステータスを draft/active/completed/archived に変換
// Usage: NOCODB_API_TOKEN=xxx node scripts/migrate-milestones-to-stories.js

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const NOCODB_API_TOKEN = process.env.NOCODB_API_TOKEN || process.env.NOCODB_TOKEN;

if (!NOCODB_API_TOKEN) {
    console.error('Error: NOCODB_API_TOKEN or NOCODB_TOKEN is required');
    process.exit(1);
}

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

const HORIZON_OPTIONS = 'quarter,month';
const VIEW_OPTIONS = 'business,user,dev';
const STATUS_OPTIONS = 'draft,active,completed,archived';

const NEW_COLUMNS = [
    { column_name: 'story_id', title: 'Story ID', uidt: 'SingleLineText' },
    { column_name: 'horizon', title: 'Horizon', uidt: 'SingleSelect', dtxp: HORIZON_OPTIONS },
    { column_name: 'view', title: 'View', uidt: 'SingleSelect', dtxp: VIEW_OPTIONS },
    { column_name: 'period', title: 'Period', uidt: 'SingleLineText' },
    { column_name: 'started_at', title: '開始日', uidt: 'Date' },
    { column_name: 'due_at', title: '期限日', uidt: 'Date' },
];

const STATUS_MAPPING = {
    '未着手': 'draft',
    '進行中': 'active',
    '完了': 'completed',
    '遅延': 'active',
};

async function apiFetch(path, options = {}) {
    const url = `${NOCODB_BASE_URL}${path}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'xc-auth': NOCODB_API_TOKEN,
            'xc-token': NOCODB_API_TOKEN,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`API Error ${response.status}: ${body}`);
    }
    return response.json();
}

async function getTableId(baseId, tableName) {
    const tables = await apiFetch(`/api/v1/db/meta/projects/${baseId}/tables`);
    const table = (tables.list || []).find(t => t.title === tableName);
    return table?.id || null;
}

async function getExistingColumns(tableId) {
    const meta = await apiFetch(`/api/v1/db/meta/tables/${tableId}`);
    return (meta.columns || []).map(c => c.title);
}

async function addColumn(tableId, column) {
    return apiFetch(`/api/v1/db/meta/tables/${tableId}/columns`, {
        method: 'POST',
        body: JSON.stringify(column),
    });
}

async function updateStatusOptions(tableId) {
    const meta = await apiFetch(`/api/v1/db/meta/tables/${tableId}`);
    const statusCol = (meta.columns || []).find(c => c.title === 'ステータス');
    if (!statusCol) {
        console.log('    ステータス column not found, skipping status migration');
        return;
    }
    await apiFetch(`/api/v1/db/meta/columns/${statusCol.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
            title: 'ステータス',
            dtxp: STATUS_OPTIONS,
        }),
    });
    console.log('    ステータス options updated → draft/active/completed/archived');
}

async function migrateStatusValues(baseId, tableId) {
    // Fetch all records and update status values
    const records = await apiFetch(`/api/v2/tables/${tableId}/records?limit=200`);
    const rows = records.list || [];
    let updated = 0;
    for (const row of rows) {
        const oldStatus = row['ステータス'];
        const newStatus = STATUS_MAPPING[oldStatus];
        if (newStatus && newStatus !== oldStatus) {
            const rowId = row.Id || row.id;
            await apiFetch(`/api/v2/tables/${tableId}/records`, {
                method: 'PATCH',
                body: JSON.stringify({ Id: rowId, 'ステータス': newStatus }),
            });
            updated++;
        }
    }
    if (updated) console.log(`    ${updated} records status migrated`);
}

async function migrateBase(base) {
    console.log(`\n--- ${base.name} (${base.id}) ---`);

    const tableId = await getTableId(base.id, 'マイルストーン');
    if (!tableId) {
        console.log('  マイルストーン table not found, skipping');
        return;
    }
    console.log(`  Table ID: ${tableId}`);

    // Check existing columns
    const existing = await getExistingColumns(tableId);
    console.log(`  Existing columns: ${existing.join(', ')}`);

    // Add new columns
    for (const col of NEW_COLUMNS) {
        if (existing.includes(col.title)) {
            console.log(`  ✓ ${col.title} already exists`);
            continue;
        }
        try {
            await addColumn(tableId, col);
            console.log(`  + Added: ${col.title}`);
        } catch (error) {
            console.error(`  ✗ Failed to add ${col.title}: ${error.message}`);
        }
    }

    // Update status options and migrate values
    try {
        await updateStatusOptions(tableId);
        await migrateStatusValues(base.id, tableId);
    } catch (error) {
        console.error(`  ✗ Status migration failed: ${error.message}`);
    }
}

async function main() {
    console.log('=== マイルストーン → Story統一モデル マイグレーション ===');
    console.log(`NocoDB: ${NOCODB_BASE_URL}`);
    console.log(`Bases: ${BASES.length}`);

    for (const base of BASES) {
        try {
            await migrateBase(base);
        } catch (error) {
            console.error(`  ✗ ${base.name}: ${error.message}`);
        }
    }

    console.log('\n=== マイグレーション完了 ===');
}

main().catch(console.error);
