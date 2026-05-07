// ストーリー遅延アラート・達成祝福自動通知
// Usage: node scripts/send-story-alerts.js [--dry-run]

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
    { code: 'baao', name: 'BAAO', baseId: 'pqj22ze3jh0mkms', tableId: 'mm6b4dlz6w2wnnj', channel: '#baao' },
    { code: 'dialogai', name: 'DialogAI', baseId: 'ptykrgx40t36l9y', tableId: 'mqjcl7pechscy1y', channel: '#dialog-ai' },
    { code: 'ncom', name: 'N.COM', baseId: 'p95wu69gwchz94m', tableId: 'mvu6jwaq67j2god', channel: '#ncom' },
    { code: 'salestailor', name: 'SalesTailor', baseId: 'pqot58neiu3o1xo', tableId: 'mmljchzw0wnzg7z', channel: '#sales-tailor' },
    { code: 'senrigan', name: '千里眼', baseId: 'p0f59uaty8zr8yd', tableId: 'ml9wn9die5f5jap', channel: '#senrigan' },
    { code: 'mywa', name: 'MyWa', baseId: 'p8gn2zt3k3bhia3', tableId: 'mvsil7ns45x5h8z', channel: '#mywa' },
    { code: 'zeims', name: 'Zeims', baseId: 'pr8u5q4qnb8op11', tableId: 'mmbujavunaxsfdl', channel: '#zeims' },
    { code: 'back_office', name: 'BackOffice', baseId: 'pypw36aox9nkhb6', tableId: 'm12o5wttp2v98zl', channel: '#back-office' },
    { code: 'brainbase', name: 'Brainbase', baseId: 'pva7l2qlu6fdfip', tableId: 'ml7hpqcvv3v8dms', channel: '#brainbase' },
    { code: 'techknight', name: 'TechKnight', baseId: 'p3tzrrtqi5hm40t', tableId: 'mqzhsliq8xiavvy', channel: '#tech-knight' },
    { code: 'vibepro', name: 'VibePro', baseId: 'pfgza5aei6wboaq', tableId: 'mjpg80jobkjo8lz', channel: '#vibepro' }
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

function detectOverdueStories(stories) {
    const now = new Date();
    const overdue = [];

    for (const story of stories) {
        const status = story['ステータス'];
        if (status === 'completed' || status === 'archived' || status === '完了') continue;

        const deadline = story['期限'] || story['Deadline'];
        if (!deadline) continue;

        const deadlineDate = new Date(deadline);
        if (isNaN(deadlineDate.getTime())) continue;

        if (deadlineDate < now) {
            const daysOverdue = Math.floor((now - deadlineDate) / (1000 * 60 * 60 * 24));
            overdue.push({
                ...story,
                daysOverdue
            });
        }
    }

    return overdue;
}

function detectCompletedStories(stories) {
    // 最近24時間以内に完了したストーリーを検知
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const completed = [];

    for (const story of stories) {
        const status = story['ステータス'];
        if (status !== 'completed' && status !== '完了') continue;

        const updatedAt = story['UpdatedAt'] || story['updated_at'];
        if (!updatedAt) continue;

        const updatedDate = new Date(updatedAt);
        if (isNaN(updatedDate.getTime())) continue;

        if (updatedDate >= yesterday) {
            completed.push(story);
        }
    }

    return completed;
}

async function sendSlackAlert(channel, text, blocks = null) {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SLACK_BOT_TOKEN}`
        },
        body: JSON.stringify({
            channel: channel,
            text: text,
            blocks: blocks || undefined
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

function buildOverdueAlert(project, overdueStories) {
    const text = `⚠️ ${project.name}: 期限超過ストーリー ${overdueStories.length}件`;

    const blocks = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: `⚠️ 期限超過ストーリー検知`,
                emoji: true
            }
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*${project.name}*で${overdueStories.length}件のストーリーが期限超過しています。`
            }
        },
        { type: 'divider' }
    ];

    overdueStories
        .sort((a, b) => b.daysOverdue - a.daysOverdue)
        .slice(0, 5) // 最大5件
        .forEach(s => {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `🔴 *${s['名前'] || s['Name']}*\n期限超過: *${s.daysOverdue}日* | 進捗率: ${s['進捗率'] || 0}%`
                }
            });
        });

    if (overdueStories.length > 5) {
        blocks.push({
            type: 'context',
            elements: [{
                type: 'mrkdwn',
                text: `他 ${overdueStories.length - 5}件のストーリーも期限超過中`
            }]
        });
    }

    return { text, blocks };
}

function buildCompletedCelebration(project, completedStories) {
    const text = `🎉 ${project.name}: ストーリー完了 ${completedStories.length}件`;

    const blocks = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: `🎉 ストーリー完了！`,
                emoji: true
            }
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*${project.name}*で${completedStories.length}件のストーリーが完了しました！`
            }
        },
        { type: 'divider' }
    ];

    completedStories.slice(0, 3).forEach(s => {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `✅ *${s['名前'] || s['Name']}*\nHorizon: ${s['Horizon'] || 'N/A'}`
            }
        });
    });

    if (completedStories.length > 3) {
        blocks.push({
            type: 'context',
            elements: [{
                type: 'mrkdwn',
                text: `他 ${completedStories.length - 3}件も完了`
            }]
        });
    }

    return { text, blocks };
}

async function processProject(project, dryRun) {
    const stories = await fetchStories(project.tableId);

    const overdue = detectOverdueStories(stories);
    const completed = detectCompletedStories(stories);

    let alerts = [];

    if (overdue.length > 0) {
        const alert = buildOverdueAlert(project, overdue);
        alerts.push({ type: 'overdue', ...alert });
    }

    if (completed.length > 0) {
        const celebration = buildCompletedCelebration(project, completed);
        alerts.push({ type: 'completed', ...celebration });
    }

    if (!dryRun) {
        for (const alert of alerts) {
            await sendSlackAlert(project.channel, alert.text, alert.blocks);
            console.log(`  ✓ Sent ${alert.type} to ${project.channel}`);
        }
    }

    return { project: project.name, overdue: overdue.length, completed: completed.length, alerts };
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');

    console.log('=== ストーリーアラート・祝福通知 ===\n');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'PRODUCTION'}\n`);

    await signin();
    console.log('✓ NocoDB認証完了\n');

    let totalOverdue = 0;
    let totalCompleted = 0;

    for (const project of PROJECTS) {
        console.log(`Processing ${project.name}...`);
        const result = await processProject(project, dryRun);

        if (result.alerts.length > 0) {
            totalOverdue += result.overdue;
            totalCompleted += result.completed;

            if (dryRun) {
                console.log(`  [DRY RUN] ${result.overdue} overdue, ${result.completed} completed`);
                result.alerts.forEach(a => {
                    console.log(`  ${a.type}: ${a.text}`);
                });
            }
        } else {
            console.log(`  No alerts`);
        }
    }

    console.log(`\n=== サマリー ===`);
    console.log(`期限超過: ${totalOverdue}件`);
    console.log(`完了: ${totalCompleted}件`);
}

main().catch(console.error);
