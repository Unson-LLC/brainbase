// 全プロジェクトストーリー進捗率をSlackに送信
// Usage: node scripts/send-story-progress-to-slack.js [--dry-run] [--channel=#general]

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const ADMIN_EMAIL = process.env.NOCODB_ADMIN_EMAIL || 'keigo@unson.co.jp';
const ADMIN_PASSWORD = process.env.NOCODB_ADMIN_PASSWORD;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

if (!ADMIN_PASSWORD) {
    console.error('Error: NOCODB_ADMIN_PASSWORD is required');
    process.exit(1);
}

if (!SLACK_BOT_TOKEN) {
    console.error('Error: SLACK_BOT_TOKEN is required');
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
    if (total === 0) return { total: 0, avgProgress: 0, byStatus: {} };

    const progressSum = stories.reduce((sum, s) => sum + (s['進捗率'] || 0), 0);
    const avgProgress = Math.round(progressSum / total);

    const byStatus = {};
    stories.forEach(s => {
        const status = s['ステータス'] || 'unknown';
        byStatus[status] = (byStatus[status] || 0) + 1;
    });

    return { total, avgProgress, byStatus };
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

function buildSlackBlocks(results) {
    const totalStories = results.reduce((sum, r) => sum + r.total, 0);
    const overallAvg = results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.avgProgress, 0) / results.length)
        : 0;

    const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

    const blocks = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: '📊 週次ストーリー進捗率サマリー',
                emoji: true
            }
        },
        {
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `集計日時: ${now}`
                }
            ]
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*全体サマリー*\n• ストーリー総数: *${totalStories}件*\n• 平均進捗率: *${overallAvg}%*`
            }
        },
        {
            type: 'divider'
        }
    ];

    // プロジェクト別（進捗率降順）
    const sorted = results.sort((a, b) => b.avgProgress - a.avgProgress);

    sorted.forEach(r => {
        const emoji = r.avgProgress >= 70 ? '🟢' : r.avgProgress >= 30 ? '🟡' : '🔴';
        const statusStr = r.byStatus
            ? Object.entries(r.byStatus).map(([s, c]) => `${s}(${c})`).join(', ')
            : '-';

        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `${emoji} *${r.name}*\n進捗率: ${r.avgProgress}% | ストーリー: ${r.total}件\nステータス: ${statusStr}`
            }
        });
    });

    // 低進捗率警告
    const lowProgress = sorted.filter(r => !r.error && r.total > 0 && r.avgProgress < 30);
    if (lowProgress.length > 0) {
        blocks.push(
            { type: 'divider' },
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `⚠️ *進捗率30%未満のプロジェクト（${lowProgress.length}件）*\n${lowProgress.map(r => `• ${r.name}: ${r.avgProgress}%`).join('\n')}`
                }
            }
        );
    }

    // 停滞プロジェクト
    const stagnant = sorted.filter(r => {
        if (r.error || !r.byStatus) return false;
        const activeCount = r.byStatus['active'] || 0;
        return activeCount > 0 && r.avgProgress < 20;
    });
    if (stagnant.length > 0) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `🚨 *停滞プロジェクト（active状態だが進捗率20%未満）*\n${stagnant.map(r => `• ${r.name}: ${r.avgProgress}% (active: ${r.byStatus['active']}件)`).join('\n')}`
            }
        });
    }

    return blocks;
}

async function sendToSlack(blocks, channel) {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
        },
        body: JSON.stringify({
            channel: channel,
            blocks: blocks,
            text: '週次ストーリー進捗率サマリー' // fallback text
        })
    });

    if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.ok) {
        throw new Error(`Slack error: ${data.error}`);
    }

    return data;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const channelArg = args.find(a => a.startsWith('--channel='));
    const channel = channelArg ? channelArg.split('=')[1] : '#brainbase';

    console.log('=== 週次ストーリー進捗率Slack送信 ===\n');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'PRODUCTION'}`);
    console.log(`Channel: ${channel}\n`);

    await signin();
    console.log('✓ NocoDB認証完了\n');

    const results = await aggregateAllProjects();
    console.log(`✓ 全${results.length}プロジェクト集計完了\n`);

    const blocks = buildSlackBlocks(results);

    if (dryRun) {
        console.log('=== Slack Block Kit（DRY RUN） ===\n');
        console.log(JSON.stringify(blocks, null, 2));
        console.log('\n=== DRY RUN完了 ===');
        return;
    }

    console.log('Slackに送信中...');
    const result = await sendToSlack(blocks, channel);

    console.log(`✓ 送信完了: ${result.channel} / ${result.ts}`);
}

main().catch(console.error);
