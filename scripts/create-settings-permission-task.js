// 設定ページ権限分離タスクをNocoDBに登録
// Usage: node scripts/create-settings-permission-task.js

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const ADMIN_EMAIL = process.env.NOCODB_ADMIN_EMAIL || 'keigo@unson.co.jp';
const ADMIN_PASSWORD = process.env.NOCODB_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('Error: NOCODB_ADMIN_PASSWORD is required');
    process.exit(1);
}

// brainbase project
const BASE_ID = 'pva7l2qlu6fdfip';
const TABLE_ID = 'ml7hpqcvv3v8dms'; // ストーリーテーブル

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

async function createTask() {
    const taskData = {
        '名前': '設定ページの権限分離実装',
        'Horizon': 'sprint',
        'ステータス': 'draft',
        '進捗率': 0,
        '期限': new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 1週間後
        '説明': `**現状**:
- 認証システムは完全実装済み（4段階アクセスレベル、ロールベース権限）
- しかし設定UIでは全タブを無条件で表示
- 権限チェックなし

**必要な実装**:
1. Settings API で現在ユーザーの auth context を取得する endpoint 追加
2. 各タブに必要な権限レベルを定義（例: integrations → level 3以上）
3. SettingsUI で権限に応じてタブをフィルタリング

**関連ファイル**:
- /server/middleware/auth.js
- /public/modules/settings/settings-ui.js
- /server/services/auth-service.js`
    };

    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${TABLE_ID}/records`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xc-auth': JWT_TOKEN
        },
        body: JSON.stringify(taskData)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create task: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result;
}

async function main() {
    console.log('=== 設定ページ権限分離タスク登録 ===\n');

    await signin();
    console.log('✓ NocoDB認証完了\n');

    const result = await createTask();
    console.log('✓ タスク作成完了');
    console.log(`  ID: ${result.Id || result.id}`);
    console.log(`  名前: ${result['名前']}`);
    console.log(`  優先度: ${result['優先度']}`);
    console.log(`  期限: ${result['期限']}\n`);

    console.log('=== 完了 ===');
}

main().catch(console.error);
