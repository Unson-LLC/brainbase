// NoCoDB テーブル名「マイルストーン」→「ストーリー」リネーム
// 全11ベースのマイルストーンテーブルの表示名を変更
// Usage: NOCODB_API_TOKEN=xxx node scripts/rename-milestone-to-story.js

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const ADMIN_EMAIL = process.env.NOCODB_ADMIN_EMAIL || 'keigo@unson.co.jp';
const ADMIN_PASSWORD = process.env.NOCODB_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('Error: NOCODB_ADMIN_PASSWORD is required');
    process.exit(1);
}

let JWT_TOKEN = null;

// テーブルIDマッピング（mana/api/nocodb-table-mapping.json より）
const TABLE_IDS = {
    'pqj22ze3jh0mkms': 'mm6b4dlz6w2wnnj',  // BAAO
    'p95wu69gwchz94m': 'mvu6jwaq67j2god',  // NCOM
    'ptykrgx40t36l9y': 'mqjcl7pechscy1y',  // DialogAI
    'pypw36aox9nkhb6': 'm12o5wttp2v98zl',  // BackOffice
    'p0f59uaty8zr8yd': 'ml9wn9die5f5jap',  // Senrigan
    'pr8u5q4qnb8op11': 'mmbujavunaxsfdl',  // Zeims
    'p8gn2zt3k3bhia3': 'mvsil7ns45x5h8z',  // Mywa
    'pqot58neiu3o1xo': 'mmljchzw0wnzg7z',  // SalesTailor
    'pva7l2qlu6fdfip': 'ml7hpqcvv3v8dms',  // Brainbase
    'p3tzrrtqi5hm40t': 'mqzhsliq8xiavvy',  // Tech Knight
    'pfgza5aei6wboaq': 'mjpg80jobkjo8lz',  // VibePro
};

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

async function signin() {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v1/auth/user/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    if (!response.ok) {
        throw new Error(`Signin failed: ${response.status}`);
    }
    const data = await response.json();
    JWT_TOKEN = data.token;
}

async function apiFetch(path, options = {}) {
    const url = `${NOCODB_BASE_URL}${path}`;
    const response = await fetch(url, {
        ...options,
        headers: {
            'xc-auth': JWT_TOKEN,
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

async function renameTable(baseId, baseName, tableId) {
    try {
        await apiFetch(`/api/v1/db/meta/tables/${tableId}`, {
            method: 'PATCH',
            body: JSON.stringify({ table_name: 'ストーリー', title: 'ストーリー' }),
        });
        console.log(`  ✓ ${baseName}: テーブル名を「ストーリー」に変更`);
    } catch (error) {
        console.error(`  ✗ ${baseName}: ${error.message}`);
    }
}

async function main() {
    console.log('=== NoCoDB テーブル名リネーム: マイルストーン → ストーリー ===');
    console.log(`NocoDB: ${NOCODB_BASE_URL}`);
    console.log(`Bases: ${BASES.length}\n`);

    console.log('Signing in...');
    await signin();
    console.log('✓ Authenticated\n');

    for (const base of BASES) {
        const tableId = TABLE_IDS[base.id];
        if (!tableId) {
            console.log(`  ✗ ${base.name}: テーブルIDが見つかりません`);
            continue;
        }
        console.log(`--- ${base.name} (${base.id}) ---`);
        console.log(`  Table ID: ${tableId}`);
        await renameTable(base.id, base.name, tableId);
    }

    console.log('\n=== リネーム完了 ===');
}

main().catch(console.error);
