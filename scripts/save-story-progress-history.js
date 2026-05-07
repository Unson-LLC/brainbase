// ストーリー進捗率履歴をNocoDBに保存
// Usage: node scripts/save-story-progress-history.js

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const ADMIN_EMAIL = process.env.NOCODB_ADMIN_EMAIL || 'keigo@unson.co.jp';
const ADMIN_PASSWORD = process.env.NOCODB_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('Error: NOCODB_ADMIN_PASSWORD is required');
    process.exit(1);
}

const PROJECTS = [
    { code: 'baao', name: 'BAAO', baseId: 'pqj22ze3jh0mkms', tableId: 'mm6b4dlz6w2wnnj' },
    { code: 'dialogai', name: 'DialogAI', baseId: 'ptykrgx40t36l9y', tableId: 'mqjcl7pechscy1y' },
    { code: 'ncom', name: 'N.COM', baseId: 'p95wu69gwchz94m', tableId: 'mvu6jwaq67j2god' },
    { code: 'salestailor', name: 'SalesTailor', baseId: 'pqot58neiu3o1xo', tableId: 'mmljchzw0wnzg7z' },
    { code: 'senrigan', name: '千里眼', baseId: 'p0f59uaty8zr8yd', tableId: 'ml9wn9die5f5jap' },
    { code: 'mywa', name: 'MyWa', baseId: 'p8gn2zt3k3bhia3', tableId: 'mvsil7ns45x5h8z' },
    { code: 'zeims', name: 'Zeims', baseId: 'pr8u5q4qnb8op11', tableId: 'mmbujavunaxsfdl' },
    { code: 'back_office', name: 'BackOffice', baseId: 'pypw36aox9nkhb6', tableId: 'm12o5wttp2v98zl' },
    { code: 'brainbase', name: 'Brainbase', baseId: 'pva7l2qlu6fdfip', tableId: 'ml7hpqcvv3v8dms' },
    { code: 'techknight', name: 'TechKnight', baseId: 'p3tzrrtqi5hm40t', tableId: 'mqzhsliq8xiavvy' },
    { code: 'vibepro', name: 'VibePro', baseId: 'pfgza5aei6wboaq', tableId: 'mjpg80jobkjo8lz' }
];

// brainbase baseの進捗率履歴テーブル
const HISTORY_TABLE_ID = 'ml7hpqcvv3v8dms'; // 暫定: brainbaseの「ストーリー」テーブルID（後でhistory専用テーブル作成推奨）

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

async function fetchStories(tableId) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${tableId}/records?limit=200`, {
        headers: { 'xc-auth': JWT_TOKEN }
    });
    if (!response.ok) throw new Error(`Failed to fetch stories: ${response.status}`);
    const data = await response.json();
    return data.list || [];
}

function calculateProgress(stories) {
    const total = stories.length;
    if (total === 0) return { total: 0, avgProgress: 0, activeCount: 0 };

    const progressSum = stories.reduce((sum, s) => sum + (s['進捗率'] || 0), 0);
    const avgProgress = Math.round(progressSum / total);

    const activeCount = stories.filter(s =>
        s['ステータス'] === 'active' || s['ステータス'] === '進行中'
    ).length;

    return { total, avgProgress, activeCount };
}

async function aggregateAllProjects() {
    const results = [];
    for (const project of PROJECTS) {
        try {
            const stories = await fetchStories(project.tableId);
            const progress = calculateProgress(stories);
            results.push({
                project_code: project.code,
                project_name: project.name,
                ...progress,
                recorded_at: new Date().toISOString()
            });
        } catch (error) {
            console.error(`Failed to aggregate ${project.code}:`, error.message);
        }
    }
    return results;
}

async function saveToHistory(records) {
    // TODO: 専用の進捗率履歴テーブル作成後、実装
    // 現在は簡易版としてJSON出力のみ
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `/tmp/story-progress-history-${timestamp}.json`;

    const { writeFileSync } = await import('fs');
    writeFileSync(filename, JSON.stringify(records, null, 2), 'utf-8');

    console.log(`✓ 進捗率履歴を保存: ${filename}`);
    return filename;
}

async function detectStagnation(records) {
    // 簡易版: 現在の進捗率のみで警告
    // TODO: 履歴テーブル実装後、3週連続低下検知を追加

    const stagnant = records.filter(r =>
        r.activeCount > 0 && r.avgProgress < 20
    );

    const critical = records.filter(r =>
        r.activeCount > 0 && r.avgProgress < 10
    );

    return { stagnant, critical };
}

async function main() {
    console.log('=== ストーリー進捗率履歴保存 ===\n');

    await signin();
    console.log('✓ 認証完了\n');

    const records = await aggregateAllProjects();
    console.log(`✓ ${records.length}プロジェクト集計完了\n`);

    const filename = await saveToHistory(records);
    console.log('');

    const { stagnant, critical } = await detectStagnation(records);

    if (critical.length > 0) {
        console.log('🚨 CRITICAL: 進捗率10%未満のプロジェクト');
        critical.forEach(r => {
            console.log(`  - ${r.project_name}: ${r.avgProgress}% (active: ${r.activeCount}件)`);
        });
        console.log('');
    }

    if (stagnant.length > 0) {
        console.log('⚠️  WARNING: 進捗率20%未満のプロジェクト');
        stagnant.forEach(r => {
            console.log(`  - ${r.project_name}: ${r.avgProgress}% (active: ${r.activeCount}件)`);
        });
        console.log('');
    }

    console.log('=== 完了 ===');
}

main().catch(console.error);
