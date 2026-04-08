// 月次OKR達成率レポート自動生成
// Usage: node scripts/generate-okr-report.js [--dry-run] [--channel=#brainbase]
//
// wiki stories.md の criteria を解析し、NoCoDB 進捗率と合わせて
// OKR達成率を計算し、Slackに投稿する

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const ADMIN_EMAIL = process.env.NOCODB_ADMIN_EMAIL || 'keigo@unson.co.jp';
const ADMIN_PASSWORD = process.env.NOCODB_ADMIN_PASSWORD;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

if (!ADMIN_PASSWORD) { console.error('Error: NOCODB_ADMIN_PASSWORD is required'); process.exit(1); }

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
    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
    const data = await response.json();
    return data.list || [];
}

function calculateOKR(stories) {
    const now = new Date();
    const currentQuarter = `Q${Math.ceil((now.getMonth() + 1) / 3)}`;
    const currentYear = now.getFullYear();
    const quarterLabel = `${currentYear}-${currentQuarter}`;

    // Quarter stories のみ対象
    const quarterStories = stories.filter(s => {
        const horizon = s['Horizon'];
        const period = s['Period'] || '';
        return (horizon === 'quarter' || horizon === 'month') &&
               (period.includes(quarterLabel) || period.includes(String(currentYear)));
    });

    // active + completed を対象
    const activeStories = quarterStories.filter(s =>
        s['ステータス'] === 'active' || s['ステータス'] === 'completed'
    );

    if (activeStories.length === 0) {
        return { total: stories.length, quarterCount: 0, avgProgress: 0, completed: 0, active: 0, quarterLabel };
    }

    const completed = activeStories.filter(s => s['ステータス'] === 'completed').length;
    const active = activeStories.filter(s => s['ステータス'] === 'active').length;
    const avgProgress = Math.round(
        activeStories.reduce((sum, s) => sum + (s['進捗率'] || 0), 0) / activeStories.length
    );

    return {
        total: stories.length,
        quarterCount: activeStories.length,
        avgProgress,
        completed,
        active,
        completionRate: activeStories.length > 0 ? Math.round((completed / activeStories.length) * 100) : 0,
        quarterLabel
    };
}

function buildReport(results) {
    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const overallAvg = results.length > 0
        ? Math.round(results.reduce((s, r) => s + r.okr.avgProgress, 0) / results.length)
        : 0;
    const totalCompleted = results.reduce((s, r) => s + r.okr.completed, 0);
    const totalActive = results.reduce((s, r) => s + r.okr.active, 0);
    const quarterLabel = results[0]?.okr.quarterLabel || '';

    let report = `# 月次OKR達成率レポート\n`;
    report += `集計日時: ${now}\n`;
    report += `対象: ${quarterLabel}\n\n`;
    report += `## 全体サマリー\n`;
    report += `- 平均進捗率: **${overallAvg}%**\n`;
    report += `- 完了ストーリー: **${totalCompleted}件**\n`;
    report += `- 進行中: **${totalActive}件**\n\n`;
    report += `## プロジェクト別\n\n`;
    report += `| PJ | 進捗率 | 完了 | 進行中 | 達成率 | 判定 |\n`;
    report += `|----|--------|------|--------|--------|------|\n`;

    const sorted = results.sort((a, b) => b.okr.avgProgress - a.okr.avgProgress);
    for (const r of sorted) {
        const emoji = r.okr.avgProgress >= 70 ? '🟢' : r.okr.avgProgress >= 30 ? '🟡' : '🔴';
        report += `| ${r.name} | ${r.okr.avgProgress}% | ${r.okr.completed} | ${r.okr.active} | ${r.okr.completionRate || 0}% | ${emoji} |\n`;
    }

    // 警告セクション
    const lowProgress = sorted.filter(r => r.okr.quarterCount > 0 && r.okr.avgProgress < 30);
    if (lowProgress.length > 0) {
        report += `\n## ⚠️ 進捗率30%未満\n`;
        lowProgress.forEach(r => {
            report += `- ${r.name}: ${r.okr.avgProgress}%\n`;
        });
    }

    const noShip = sorted.filter(r => r.okr.quarterCount > 0 && r.okr.completed === 0);
    if (noShip.length > 0) {
        report += `\n## 🔴 Ship=0（完了ストーリーなし）\n`;
        noShip.forEach(r => {
            report += `- ${r.name}: active ${r.okr.active}件\n`;
        });
    }

    return report;
}

function buildSlackBlocks(results) {
    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    const overallAvg = results.length > 0
        ? Math.round(results.reduce((s, r) => s + r.okr.avgProgress, 0) / results.length)
        : 0;
    const totalCompleted = results.reduce((s, r) => s + r.okr.completed, 0);
    const quarterLabel = results[0]?.okr.quarterLabel || '';

    const blocks = [
        { type: 'header', text: { type: 'plain_text', text: '📈 月次OKR達成率レポート', emoji: true } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `${now} | ${quarterLabel}` }] },
        { type: 'section', text: { type: 'mrkdwn', text: `*全体*\n• 平均進捗率: *${overallAvg}%*\n• 完了ストーリー: *${totalCompleted}件*` } },
        { type: 'divider' }
    ];

    const sorted = results.sort((a, b) => b.okr.avgProgress - a.okr.avgProgress);
    sorted.forEach(r => {
        const emoji = r.okr.avgProgress >= 70 ? '🟢' : r.okr.avgProgress >= 30 ? '🟡' : '🔴';
        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: `${emoji} *${r.name}*\n進捗: ${r.okr.avgProgress}% | 完了: ${r.okr.completed} | 進行中: ${r.okr.active}` }
        });
    });

    return blocks;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const channelArg = args.find(a => a.startsWith('--channel='));
    const channel = channelArg ? channelArg.split('=')[1] : '#brainbase';

    console.log('=== 月次OKR達成率レポート ===\n');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'PRODUCTION'}\n`);

    await signin();
    console.log('✓ 認証完了\n');

    const results = [];
    for (const p of PROJECTS) {
        try {
            const stories = await fetchStories(p.tableId);
            const okr = calculateOKR(stories);
            results.push({ name: p.name, code: p.code, okr });
        } catch (err) {
            console.error(`✗ ${p.name}: ${err.message}`);
            results.push({ name: p.name, code: p.code, okr: { total: 0, quarterCount: 0, avgProgress: 0, completed: 0, active: 0, completionRate: 0 } });
        }
    }

    console.log(`✓ ${results.length}プロジェクト集計完了\n`);

    // Markdownレポート生成
    const report = buildReport(results);

    if (dryRun) {
        console.log(report);
        console.log('\n=== DRY RUN完了 ===');
        return;
    }

    // ファイル保存
    const { writeFileSync, mkdirSync } = await import('fs');
    const timestamp = new Date().toISOString().slice(0, 7); // YYYY-MM
    mkdirSync('/tmp/okr', { recursive: true });
    const filename = `/tmp/okr/okr_report_${timestamp}.md`;
    writeFileSync(filename, report, 'utf-8');
    console.log(`✓ レポート保存: ${filename}`);

    // Slack投稿
    if (SLACK_BOT_TOKEN) {
        const blocks = buildSlackBlocks(results);
        const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SLACK_BOT_TOKEN}` },
            body: JSON.stringify({ channel, blocks, text: '月次OKR達成率レポート' })
        });
        const slackData = await slackRes.json();
        if (slackData.ok) {
            console.log(`✓ Slack投稿完了: ${channel}`);
        } else {
            console.error(`✗ Slack投稿失敗: ${slackData.error}`);
        }
    }

    console.log('\n=== 完了 ===');
}

main().catch(console.error);
