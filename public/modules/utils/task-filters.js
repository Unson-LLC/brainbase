/**
 * タスクフィルタリングユーティリティ
 */

/**
 * 優先度ラベルマッピング（英語→日本語）
 */
export const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' };

/**
 * 優先度ラベルを日本語で取得
 * @param {string} priority - 英語優先度 ('high', 'medium', 'low')
 * @returns {string} 日本語ラベル
 */
export function getPriorityLabel(priority) {
    return PRIORITY_LABELS[priority] || priority;
}

/**
 * タスクが進行中かどうか判定
 * ステータスの表記揺れ (in-progress, in_progress, doing) を吸収する
 * @param {Object} task - タスクオブジェクト
 * @returns {boolean}
 */
export function isTaskInProgress(task) {
    const s = task?.status;
    return s === 'in-progress' || s === 'in_progress' || s === 'doing';
}

/**
 * 優先度でタスクをフィルタリング
 * @param {Array} tasks - タスク配列
 * @param {string} priority - フィルタする優先度 ('high', 'medium', 'low', 'critical', 'highest', 'normal')
 * @returns {Array} フィルタリング後のタスク配列
 */
export function filterByPriority(tasks, priority) {
    if (!priority || priority === 'all') {
        return tasks;
    }

    // 優先度のマッピング（類似優先度を含む）
    const priorityMap = {
        'critical': ['critical'],
        'highest': ['highest'],
        'high': ['high'],
        'medium': ['medium'],
        'normal': ['normal'],
        'low': ['low', '']
    };

    const acceptedPriorities = priorityMap[priority.toLowerCase()] || [priority.toLowerCase()];

    return tasks.filter(task => {
        const taskPriority = (task.priority || '').toLowerCase();
        return acceptedPriorities.includes(taskPriority);
    });
}

/**
 * ステータスでタスクをフィルタリング
 * @param {Array} tasks - タスク配列
 * @param {string} status - フィルタするステータス ('todo', 'doing', 'done', 'blocked', 'deferred')
 * @returns {Array} フィルタリング後のタスク配列
 */
export function filterByStatus(tasks, status) {
    if (!status || status === 'all') {
        return tasks;
    }

    return tasks.filter(task => task.status === status);
}

/**
 * オーナーでタスクをフィルタリング
 * @param {Array} tasks - タスク配列
 * @param {string} owner - フィルタするオーナー名
 * @returns {Array} フィルタリング後のタスク配列
 */
export function filterByOwner(tasks, owner) {
    if (!owner || owner === 'all') {
        return tasks;
    }

    return tasks.filter(task => task.owner === owner);
}

/**
 * テキストでタスクをフィルタリング（name, descriptionを検索）
 * @param {Array} tasks - タスク配列
 * @param {string} searchText - 検索テキスト
 * @returns {Array} フィルタリング後のタスク配列
 */
export function filterByText(tasks, searchText) {
    if (!searchText) {
        return tasks;
    }

    const lowerSearchText = searchText.toLowerCase();

    return tasks.filter(task => {
        const name = (task.name || '').toLowerCase();
        const description = (task.description || '').toLowerCase();
        return name.includes(lowerSearchText) || description.includes(lowerSearchText);
    });
}
