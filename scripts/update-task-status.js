// Canonical Taskステータス更新スクリプト
// Usage: node scripts/update-task-status.js <task_title_keyword> <new_status>
import { CanonicalTaskApiClient } from './lib/canonical-task-api-client.js';

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: node scripts/update-task-status.js <task_title_keyword> <new_status>');
        console.log('Example: node scripts/update-task-status.js "story_id紐付け" "完了"');
        process.exit(1);
    }

    const [keyword, newStatus] = args;
    const client = new CanonicalTaskApiClient();
    console.log('=== Canonical Task Status Update ===\n');
    console.log(`Keyword: "${keyword}"`);
    console.log(`New Status: "${newStatus}"\n`);

    const tasks = await client.listTasks();
    const matchedTasks = tasks.filter(task =>
        task.title?.includes(keyword) || task.description?.includes(keyword)
    );
    console.log(`Matched tasks: ${matchedTasks.length}`);

    for (const task of matchedTasks) {
        console.log(`\n[${task.id}] ${task.title}`);
        console.log(`  Current status: ${task.status}`);
        await client.transitionTask(task, newStatus, 'update-task-status');
        console.log(`  ✓ Updated to: ${newStatus}`);
    }
    console.log('\n=== Complete ===');
}

main().catch(console.error);
