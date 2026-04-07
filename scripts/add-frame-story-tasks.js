// Frame/Story関連タスクをNoCoDB brainbase タスクテーブルに一括登録
// Usage: node scripts/add-frame-story-tasks.js

const NOCODB_BASE_URL = process.env.NOCODB_BASE_URL || 'https://noco.unson.jp';
const ADMIN_EMAIL = process.env.NOCODB_ADMIN_EMAIL || 'keigo@unson.co.jp';
const ADMIN_PASSWORD = process.env.NOCODB_ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('Error: NOCODB_ADMIN_PASSWORD is required');
    process.exit(1);
}

const BRAINBASE_TASK_TABLE_ID = 'm7iys8m7o1abr3f';

const TASKS = [
    {
        title: "NoCoDB全11PJ「ストーリー」テーブルstory_id紐付け",
        description: "wiki stories.mdのstory_idとNoCoDB「ストーリー」レコードを紐付け。進捗率・ステータスがポータルに反映されるようにする。\n\n対象: 全11プロジェクト（BAAO, DialogAI, NCOM, SalesTailor, Senrigan, Mywa, Zeims, BackOffice, Brainbase, TechKnight, VibePro）",
        priority: "高",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "TechKnight stories.mdパース修正",
        description: "YAMLコードブロック形式のパース確認・修正。現在Stories=0になっている問題を解決。",
        priority: "高",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "BackOffice: Frame/Story作成",
        description: "frame.md（WHO/WHAT/HOW）+ stories.md（northstar/annual/quarter/month層、business/user/dev視点）",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "Mana: Frame/Story作成",
        description: "frame.md（WHO/WHAT/HOW）+ stories.md（northstar/annual/quarter/month層、business/user/dev視点）",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "Mywa: Frame/Story作成",
        description: "frame.md（WHO/WHAT/HOW）+ stories.md（northstar/annual/quarter/month層、business/user/dev視点）",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "NCOM: Frame/Story作成",
        description: "frame.md（WHO/WHAT/HOW）+ stories.md（northstar/annual/quarter/month層、business/user/dev視点）",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "VibePro: Frame/Story作成",
        description: "frame.md（WHO/WHAT/HOW）+ stories.md（northstar/annual/quarter/month層、business/user/dev視点）",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "BAAO: ストーリー精度アップ",
        description: "enemy/criteria/beat_map定義の充実。business/user/dev視点の補完。quarter/month層の具体化。",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "Brainbase: ストーリー精度アップ",
        description: "enemy/criteria/beat_map定義の充実。business/user/dev視点の補完。quarter/month層の具体化。",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "SalesTailor: ストーリー精度アップ",
        description: "enemy/criteria/beat_map定義の充実。business/user/dev視点の補完。quarter/month層の具体化。",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "Senrigan: ストーリー精度アップ",
        description: "enemy/criteria/beat_map定義の充実。business/user/dev視点の補完。quarter/month層の具体化。",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "TechKnight: ストーリー精度アップ",
        description: "enemy/criteria/beat_map定義の充実。business/user/dev視点の補完。quarter/month層の具体化。",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "Zeims: ストーリー精度アップ",
        description: "enemy/criteria/beat_map定義の充実。business/user/dev視点の補完。quarter/month層の具体化。",
        priority: "中",
        status: "未着手",
        project: "brainbase"
    },
    {
        title: "全PJ: Event記録の継続・充実",
        description: "Decision/Work/Ship/Learnイベント継続記録。NocoDBシップ・スプリントテーブル連携活用。\n\n継続的なタスクのため、完了期限なし。",
        priority: "低",
        status: "進行中",
        project: "brainbase"
    }
];

let JWT_TOKEN = null;

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

async function createTask(task) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${BRAINBASE_TASK_TABLE_ID}/records`, {
        method: 'POST',
        headers: {
            'xc-auth': JWT_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            'タイトル': task.title,
            '説明': task.description,
            'ステータス': task.status,
            '優先度': task.priority,
            'プロジェクト': task.project
        })
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Failed to create task: ${response.status} ${body}`);
    }

    return response.json();
}

async function main() {
    console.log('=== Frame/Story タスク一括登録 ===');
    console.log(`NocoDB: ${NOCODB_BASE_URL}`);
    console.log(`Tasks: ${TASKS.length}\n`);

    console.log('Signing in...');
    await signin();
    console.log('✓ Authenticated\n');

    let created = 0;
    for (const task of TASKS) {
        try {
            await createTask(task);
            console.log(`✓ ${task.title}`);
            created++;
        } catch (error) {
            console.error(`✗ ${task.title}: ${error.message}`);
        }
    }

    console.log(`\n=== 完了: ${created}/${TASKS.length}件登録 ===`);
}

main().catch(console.error);
