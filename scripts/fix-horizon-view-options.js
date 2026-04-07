// NoCoDB「ストーリー」テーブルのHorizon/View/Statusカラムoptions修正
// Usage: node scripts/fix-horizon-view-options.js

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const ADMIN_EMAIL = process.env.NOCODB_ADMIN_EMAIL || 'keigo@unson.co.jp';
const ADMIN_PASSWORD = process.env.NOCODB_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('Error: NOCODB_ADMIN_PASSWORD is required');
    process.exit(1);
}

const HORIZON_OPTIONS = 'northstar,annual,quarter,month,sprint';
const VIEW_OPTIONS = 'business,user,dev';
const STATUS_OPTIONS = 'draft,active,completed,archived';

const TABLE_IDS = [
    { project: 'BAAO', tableId: 'mm6b4dlz6w2wnnj' },
    { project: 'DialogAI', tableId: 'mqjcl7pechscy1y' },
    { project: 'NCOM', tableId: 'mvu6jwaq67j2god' },
    { project: 'SalesTailor', tableId: 'mmljchzw0wnzg7z' },
    { project: 'Senrigan', tableId: 'ml9wn9die5f5jap' },
    { project: 'Mywa', tableId: 'mvsil7ns45x5h8z' },
    { project: 'Zeims', tableId: 'mmbujavunaxsfdl' },
    { project: 'BackOffice', tableId: 'm12o5wttp2v98zl' },
    { project: 'Brainbase', tableId: 'ml7hpqcvv3v8dms' },
    { project: 'TechKnight', tableId: 'mqzhsliq8xiavvy' },
    { project: 'VibePro', tableId: 'mjpg80jobkjo8lz' }
];

let JWT_TOKEN = null;

async function signin() {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v1/auth/user/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    if (!response.ok) throw new Error(`Signin failed: ${response.status}`);
    const data = await response.json();
    JWT_TOKEN = data.token;
}

async function getTableMeta(tableId) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v1/db/meta/tables/${tableId}`, {
        headers: { 'xc-auth': JWT_TOKEN }
    });
    if (!response.ok) throw new Error(`Get meta failed: ${response.status}`);
    return response.json();
}

async function updateColumn(columnId, options) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v1/db/meta/columns/${columnId}`, {
        method: 'PATCH',
        headers: {
            'xc-auth': JWT_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(options)
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Update failed: ${response.status} ${body}`);
    }
    return response.json();
}

async function fixTable(tableInfo) {
    console.log(`\n--- ${tableInfo.project} ---`);

    const meta = await getTableMeta(tableInfo.tableId);
    const horizonCol = meta.columns.find(c => c.title === 'Horizon');
    const viewCol = meta.columns.find(c => c.title === 'View');
    const statusCol = meta.columns.find(c => c.title === 'ステータス');

    let fixed = 0;

    if (horizonCol) {
        console.log(`  Horizon column ID: ${horizonCol.id}`);
        await updateColumn(horizonCol.id, { dtxp: HORIZON_OPTIONS });
        console.log(`  ✓ Updated Horizon options: ${HORIZON_OPTIONS}`);
        fixed++;
    } else {
        console.log(`  ⚠️  Horizon column not found`);
    }

    if (viewCol) {
        console.log(`  View column ID: ${viewCol.id}`);
        await updateColumn(viewCol.id, { dtxp: VIEW_OPTIONS });
        console.log(`  ✓ Updated View options: ${VIEW_OPTIONS}`);
        fixed++;
    } else {
        console.log(`  ⚠️  View column not found`);
    }

    if (statusCol) {
        console.log(`  Status column ID: ${statusCol.id}`);
        await updateColumn(statusCol.id, { dtxp: STATUS_OPTIONS });
        console.log(`  ✓ Updated Status options: ${STATUS_OPTIONS}`);
        fixed++;
    } else {
        console.log(`  ⚠️  Status column not found`);
    }

    return fixed;
}

async function main() {
    console.log('=== Horizon/View/Status Options修正 ===');
    console.log(`NocoDB: ${NOCODB_BASE_URL}\n`);

    console.log('Signing in...');
    await signin();
    console.log('✓ Authenticated\n');

    let totalFixed = 0;
    for (const tableInfo of TABLE_IDS) {
        try {
            const fixed = await fixTable(tableInfo);
            totalFixed += fixed;
        } catch (error) {
            console.error(`✗ ${tableInfo.project}: ${error.message}`);
        }
    }

    console.log(`\n=== 完了: ${totalFixed}カラム修正 ===`);
}

main().catch(console.error);
