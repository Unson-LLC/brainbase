// 高優先度タスクリスト表示
// Usage: node scripts/list-high-priority-tasks.js
import { pathToFileURL } from 'node:url';

import { CanonicalTaskApiClient } from './lib/canonical-task-api-client.js';

const STATUS_LABELS = Object.freeze({
    pending: '未着手',
    in_progress: '進行中'
});

export function selectHighPriorityTasks(tasks) {
    return tasks
        .filter(task => task.priority === 'high' && (task.status === 'pending' || task.status === 'in_progress'))
        .sort((a, b) => String(a.id).localeCompare(String(b.id), 'ja'));
}

export async function listHighPriorityTasks({ client = new CanonicalTaskApiClient(), log = console.log } = {}) {
    log('=== 高優先度タスク（未着手/進行中） ===\n');

    const highPriority = selectHighPriorityTasks(await client.listTasks());

    highPriority.forEach(task => {
        log(`[${task.id}] ${task.title}`);
        log(`  ステータス: ${STATUS_LABELS[task.status]}`);
        const description = String(task.description || '');
        const excerpt = description.substring(0, 150);
        if (excerpt) {
            log(`  説明: ${excerpt}${description.length > 150 ? '...' : ''}`);
        }
        log('');
    });

    log(`Total: ${highPriority.length}件`);
    return highPriority;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
    listHighPriorityTasks().catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
