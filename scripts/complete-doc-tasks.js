// ドキュメント系タスク5件のステータスをcompletedに更新
const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const ADMIN_EMAIL = process.env.NOCODB_ADMIN_EMAIL || 'keigo@unson.co.jp';
const ADMIN_PASSWORD = process.env.NOCODB_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) { console.error('Error: NOCODB_ADMIN_PASSWORD is required'); process.exit(1); }

const TABLE_ID = 'm7iys8m7o1abr3f'; // brainbase タスクテーブル
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

async function fetchAllStories() {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${TABLE_ID}/records?limit=200`, {
        headers: { 'xc-auth': JWT_TOKEN }
    });
    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
    const data = await response.json();
    return data.list || [];
}

async function updateStatus(id, status) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${TABLE_ID}/records`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'xc-auth': JWT_TOKEN },
        body: JSON.stringify({ Id: id, 'ステータス': '完了' })
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to update ${id}: ${response.status} - ${text}`);
    }
    return await response.json();
}

const DOC_TASK_NAMES = [
    'Event記録ガイド作成',
    'ポータル確認フロー定義',
    '週次ストーリー進捗更新手順書',
    'mana M9チェック活用ガイド',
    'NoCoDB入力ルール文書化'
];

async function main() {
    console.log('=== ドキュメントタスク完了更新 ===\n');

    await signin();
    console.log('✓ 認証完了\n');

    const tasks = await fetchAllStories();
    console.log(`タスク総数: ${tasks.length}\n`);

    // フィールド名を確認（タイトル or 名前）
    if (tasks.length > 0) {
        const sample = tasks[0];
        const titleField = sample['タイトル'] !== undefined ? 'タイトル' : '名前';
        console.log(`タイトルフィールド: ${titleField}\n`);

        for (const name of DOC_TASK_NAMES) {
            const task = tasks.find(s => (s[titleField] || '').includes(name));
            if (!task) {
                console.log(`✗ "${name}" — 見つかりません`);
                continue;
            }
            if (task['ステータス'] === '完了') {
                console.log(`- "${name}" — 既に完了`);
                continue;
            }
            try {
                await updateStatus(task.Id, '完了');
                console.log(`✓ "${task[titleField]}" (ID:${task.Id}) → 完了`);
            } catch (e) {
                console.log(`✗ "${task[titleField]}" — ${e.message}`);
            }
        }
    }

    console.log('\n=== 完了 ===');
}

main().catch(console.error);
