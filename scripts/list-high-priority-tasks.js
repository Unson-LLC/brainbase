// 高優先度タスクリスト表示
// Usage: node scripts/list-high-priority-tasks.js

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const ADMIN_EMAIL = process.env.NOCODB_ADMIN_EMAIL || 'keigo@unson.co.jp';
const ADMIN_PASSWORD = process.env.NOCODB_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('Error: NOCODB_ADMIN_PASSWORD is required');
    process.exit(1);
}

const BRAINBASE_TASK_TABLE_ID = 'm7iys8m7o1abr3f';

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

async function fetchTasks() {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${BRAINBASE_TASK_TABLE_ID}/records?limit=200`, {
        headers: { 'xc-auth': JWT_TOKEN }
    });
    if (!response.ok) throw new Error(`Failed to fetch tasks: ${response.status}`);
    const data = await response.json();
    return data.list || [];
}

async function main() {
    console.log('=== 高優先度タスク（未着手/進行中） ===\n');

    await signin();
    console.log('✓ Authenticated\n');

    const tasks = await fetchTasks();
    const highPriority = tasks
        .filter(t => t['優先度'] === '高' && (t['ステータス'] === '未着手' || t['ステータス'] === '進行中'))
        .sort((a, b) => (a['番号'] || 0) - (b['番号'] || 0));

    highPriority.forEach(t => {
        console.log(`[${t['番号']}] ${t['タイトル']}`);
        console.log(`  ステータス: ${t['ステータス']}`);
        const desc = (t['説明'] || '').substring(0, 150);
        if (desc) {
            console.log(`  説明: ${desc}${(t['説明'] || '').length > 150 ? '...' : ''}`);
        }
        console.log('');
    });

    console.log(`Total: ${highPriority.length}件`);
}

main().catch(console.error);
