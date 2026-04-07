// NoCoDB「ストーリー」テーブルのstory_id未紐付けレコード検知スクリプト
// Usage: node scripts/check-missing-story-ids.js [--slack]

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const ADMIN_EMAIL = process.env.NOCODB_ADMIN_EMAIL || 'keigo@unson.co.jp';
const ADMIN_PASSWORD = process.env.NOCODB_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('Error: NOCODB_ADMIN_PASSWORD is required');
    process.exit(1);
}

const PROJECTS = [
    { code: 'baao', tableId: 'mm6b4dlz6w2wnnj' },
    { code: 'dialogai', tableId: 'mqjcl7pechscy1y' },
    { code: 'ncom', tableId: 'mvu6jwaq67j2god' },
    { code: 'salestailor', tableId: 'mmljchzw0wnzg7z' },
    { code: 'senrigan', tableId: 'ml9wn9die5f5jap' },
    { code: 'mywa', tableId: 'mvsil7ns45x5h8z' },
    { code: 'zeims', tableId: 'mmbujavunaxsfdl' },
    { code: 'back_office', tableId: 'm12o5wttp2v98zl' },
    { code: 'brainbase', tableId: 'ml7hpqcvv3v8dms' },
    { code: 'techknight', tableId: 'mqzhsliq8xiavvy' },
    { code: 'vibepro', tableId: 'mjpg80jobkjo8lz' }
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

async function fetchRecords(tableId) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${tableId}/records?limit=200`, {
        headers: { 'xc-auth': JWT_TOKEN }
    });
    if (!response.ok) throw new Error(`Failed to fetch records: ${response.status}`);
    const data = await response.json();
    return data.list || [];
}

async function checkProject(project) {
    const records = await fetchRecords(project.tableId);
    const total = records.length;

    const missingStoryId = records.filter(r => {
        const storyId = r['Story ID'] || r['story_id'];
        return !storyId || storyId.trim() === '';
    });

    return {
        project: project.code,
        total,
        missing: missingStoryId.length,
        missingRecords: missingStoryId.map(r => ({
            id: r.Id || r.ID,
            name: r['名前'] || r['name'] || r['マイルストーン名'] || '(no name)',
            horizon: r.Horizon || r.horizon || '',
            status: r['ステータス'] || r.status || ''
        }))
    };
}

function generateSlackMessage(results) {
    const totalMissing = results.reduce((sum, r) => sum + r.missing, 0);

    if (totalMissing === 0) {
        return {
            text: '✅ All story records have Story IDs linked',
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '*✅ Story ID紐付け状況: すべて完了*\n\n全11プロジェクトのストーリーレコードにStory IDが紐付けられています。'
                    }
                }
            ]
        };
    }

    const blocks = [
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*⚠️ Story ID未紐付けレコード検知: ${totalMissing}件*\n\n以下のプロジェクトでStory IDが未設定のレコードがあります。`
            }
        },
        {
            type: 'divider'
        }
    ];

    for (const result of results) {
        if (result.missing > 0) {
            const recordList = result.missingRecords
                .slice(0, 5)
                .map(r => `• [${r.id}] ${r.name} (${r.horizon || 'no horizon'})`)
                .join('\n');

            const moreText = result.missingRecords.length > 5
                ? `\n... and ${result.missingRecords.length - 5} more`
                : '';

            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `*${result.project.toUpperCase()}*: ${result.missing}/${result.total}件\n${recordList}${moreText}`
                }
            });
        }
    }

    blocks.push({
        type: 'context',
        elements: [
            {
                type: 'mrkdwn',
                text: '💡 修正方法: `node scripts/link-story-ids-to-nocodb.js --project=<project_code>`'
            }
        ]
    });

    return {
        text: `⚠️ Story ID未紐付けレコード: ${totalMissing}件`,
        blocks
    };
}

async function sendSlackNotification(message) {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
        console.log('\n⚠️  SLACK_WEBHOOK_URL not set, skipping Slack notification');
        return;
    }

    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
    });

    if (!response.ok) {
        throw new Error(`Slack notification failed: ${response.status}`);
    }

    console.log('\n✓ Slack notification sent');
}

async function main() {
    const args = process.argv.slice(2);
    const sendSlack = args.includes('--slack');

    console.log('=== Story ID未紐付けレコード検知 ===\n');

    await signin();
    console.log('✓ Authenticated\n');

    const results = [];
    let totalMissing = 0;

    for (const project of PROJECTS) {
        try {
            const result = await checkProject(project);
            results.push(result);

            console.log(`${project.code.toUpperCase()}: ${result.missing}/${result.total}件 未紐付け`);

            if (result.missing > 0) {
                totalMissing += result.missing;
                result.missingRecords.forEach(r => {
                    console.log(`  - [${r.id}] ${r.name} (${r.horizon})`);
                });
            }
        } catch (error) {
            console.error(`✗ ${project.code}: ${error.message}`);
        }
    }

    console.log(`\n=== 合計: ${totalMissing}件未紐付け ===`);

    if (sendSlack) {
        const message = generateSlackMessage(results);
        await sendSlackNotification(message);
    }

    // 未紐付けがある場合はexit code 1
    process.exit(totalMissing > 0 ? 1 : 0);
}

main().catch(console.error);
