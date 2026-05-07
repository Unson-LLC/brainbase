// NocoDBタスクステータス更新スクリプト
// Usage: node scripts/update-task-status.js <task_title_keyword> <new_status>

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

async function updateTask(taskId, updates) {
    const response = await fetch(`${NOCODB_BASE_URL}/api/v2/tables/${BRAINBASE_TASK_TABLE_ID}/records`, {
        method: 'PATCH',
        headers: {
            'xc-auth': JWT_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            Id: taskId,
            ...updates
        })
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Update failed: ${response.status} ${body}`);
    }
    return response.json();
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: node scripts/update-task-status.js <task_title_keyword> <new_status>');
        console.log('Example: node scripts/update-task-status.js "story_id紐付け" "完了"');
        process.exit(1);
    }

    const keyword = args[0];
    const newStatus = args[1];

    console.log('=== NoCoDB Task Status Update ===\n');
    console.log(`Keyword: "${keyword}"`);
    console.log(`New Status: "${newStatus}"\n`);

    await signin();
    console.log('✓ Authenticated\n');

    const tasks = await fetchTasks();
    console.log(`Total tasks: ${tasks.length}\n`);

    const matchedTasks = tasks.filter(t =>
        (t['タイトル'] || '').includes(keyword) ||
        (t['説明'] || '').includes(keyword)
    );

    console.log(`Matched tasks: ${matchedTasks.length}`);

    for (const task of matchedTasks) {
        console.log(`\n[${task.Id}] ${task['タイトル']}`);
        console.log(`  Current status: ${task['ステータス']}`);

        await updateTask(task.Id, { 'ステータス': newStatus });
        console.log(`  ✓ Updated to: ${newStatus}`);
    }

    console.log('\n=== Complete ===');
}

main().catch(console.error);
