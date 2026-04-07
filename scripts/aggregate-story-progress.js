// 全プロジェクトのストーリー進捗率を集計
// Usage: node scripts/aggregate-story-progress.js [--json]

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
    if (total === 0) return { total: 0, avgProgress: 0, byStatus: {}, byHorizon: {} };

    // 進捗率平均
    const progressSum = stories.reduce((sum, s) => sum + (s['進捗率'] || 0), 0);
    const avgProgress = Math.round(progressSum / total);

    // ステータス別集計
    const byStatus = {};
    stories.forEach(s => {
        const status = s['ステータス'] || 'unknown';
        byStatus[status] = (byStatus[status] || 0) + 1;
    });

    // Horizon別集計
    const byHorizon = {};
    stories.forEach(s => {
        const horizon = s['Horizon'] || 'unknown';
        if (!byHorizon[horizon]) {
            byHorizon[horizon] = { count: 0, avgProgress: 0 };
        }
        byHorizon[horizon].count++;
        byHorizon[horizon].avgProgress += (s['進捗率'] || 0);
    });

    Object.keys(byHorizon).forEach(h => {
        const count = byHorizon[h].count;
        byHorizon[h].avgProgress = count > 0 ? Math.round(byHorizon[h].avgProgress / count) : 0;
    });

    return { total, avgProgress, byStatus, byHorizon };
}

async function aggregateAllProjects() {
    const results = [];

    for (const project of PROJECTS) {
        try {
            const stories = await fetchStories(project.tableId);
            const progress = calculateProgress(stories);

            results.push({
                code: project.code,
                name: project.name,
                ...progress
            });
        } catch (error) {
            results.push({
                code: project.code,
                name: project.name,
                error: error.message,
                total: 0,
                avgProgress: 0
            });
        }
    }

    return results;
}

async function main() {
    const args = process.argv.slice(2);
    const jsonOutput = args.includes('--json');

    await signin();

    const results = await aggregateAllProjects();

    if (jsonOutput) {
        console.log(JSON.stringify(results, null, 2));
        return;
    }

    // テキスト形式出力
    console.log('=== 全プロジェクトストーリー進捗率サマリー ===\n');
    console.log(`集計日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}\n`);

    // 全体サマリー
    const totalStories = results.reduce((sum, r) => sum + r.total, 0);
    const overallAvg = results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.avgProgress, 0) / results.length)
        : 0;

    console.log(`全体: ${totalStories}件のストーリー / 平均進捗率: ${overallAvg}%\n`);

    // プロジェクト別
    results
        .sort((a, b) => b.avgProgress - a.avgProgress)
        .forEach(r => {
            console.log(`【${r.name}】`);
            if (r.error) {
                console.log(`  ⚠️  エラー: ${r.error}`);
            } else {
                console.log(`  ストーリー数: ${r.total}件`);
                console.log(`  平均進捗率: ${r.avgProgress}%`);
                if (r.byStatus) {
                    const statusStr = Object.entries(r.byStatus)
                        .map(([s, c]) => `${s}(${c})`)
                        .join(', ');
                    console.log(`  ステータス: ${statusStr}`);
                }
                if (r.byHorizon && Object.keys(r.byHorizon).length > 0) {
                    const horizonStr = Object.entries(r.byHorizon)
                        .map(([h, d]) => `${h}:${d.avgProgress}%(${d.count})`)
                        .join(', ');
                    console.log(`  Horizon別: ${horizonStr}`);
                }
            }
            console.log('');
        });

    // 低進捗率プロジェクト警告
    const lowProgress = results.filter(r => !r.error && r.total > 0 && r.avgProgress < 30);
    if (lowProgress.length > 0) {
        console.log('⚠️  進捗率30%未満のプロジェクト:');
        lowProgress.forEach(r => {
            console.log(`  - ${r.name}: ${r.avgProgress}% (${r.total}件)`);
        });
        console.log('');
    }

    // 停滞プロジェクト（activeだが進捗率低い）
    const stagnant = results.filter(r => {
        if (r.error || !r.byStatus) return false;
        const activeCount = r.byStatus['active'] || 0;
        return activeCount > 0 && r.avgProgress < 20;
    });
    if (stagnant.length > 0) {
        console.log('🚨 停滞プロジェクト（active状態だが進捗率20%未満）:');
        stagnant.forEach(r => {
            console.log(`  - ${r.name}: ${r.avgProgress}% (active: ${r.byStatus['active']}件)`);
        });
        console.log('');
    }
}

main().catch(console.error);
