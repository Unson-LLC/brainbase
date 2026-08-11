// ドキュメント系Canonical Task 5件を完了へ遷移
import { CanonicalTaskApiClient } from './lib/canonical-task-api-client.js';

const DOC_TASK_NAMES = [
    'Event記録ガイド作成',
    'ポータル確認フロー定義',
    '週次ストーリー進捗更新手順書',
    'mana M9チェック活用ガイド',
    'NoCoDB入力ルール文書化'
];

async function main() {
    const client = new CanonicalTaskApiClient();
    console.log('=== ドキュメントタスク完了更新 ===\n');
    const tasks = await client.listTasks();
    console.log(`タスク総数: ${tasks.length}\n`);

    for (const name of DOC_TASK_NAMES) {
        const task = tasks.find(candidate => candidate.title?.includes(name));
        if (!task) {
            console.log(`✗ "${name}" - 見つかりません`);
            continue;
        }
        if (task.status === 'completed') {
            console.log(`- "${name}" - 既に完了`);
            continue;
        }
        try {
            await client.transitionTask(task, 'completed', 'complete-doc-tasks');
            console.log(`✓ "${task.title}" → 完了`);
        } catch (error) {
            console.log(`✗ "${task.title}" - ${error.message}`);
        }
    }
    console.log('\n=== 完了 ===');
}

main().catch(console.error);
