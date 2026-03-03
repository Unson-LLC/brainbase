/**
 * タスクフィルタリングユーティリティ
 */

const FILTER_ALL = 'all';

// 優先度のマッピング（類似優先度を含む）
const PRIORITY_MAP = {
    'critical': ['critical'],
    'highest': ['highest'],
    'high': ['high'],
    'medium': ['medium'],
    'normal': ['normal'],
    'low': ['low', '']
};

const toLower = (value) => (value || '').toLowerCase();
const shouldSkipFilter = (value) => !value || value === FILTER_ALL;

/**
 * 優先度でタスクをフィルタリング
 * @param {Array} tasks - タスク配列
 * @param {string} priority - フィルタする優先度 ('high', 'medium', 'low', 'critical', 'highest', 'normal')
 * @returns {Array} フィルタリング後のタスク配列
 */
export function filterByPriority(tasks, priority) {
    if (shouldSkipFilter(priority)) {
        return tasks;
    }

    const normalizedPriority = toLower(priority);
    const acceptedPriorities = PRIORITY_MAP[normalizedPriority] || [normalizedPriority];

    return tasks.filter(task => {
        const taskPriority = toLower(task.priority);
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
    if (shouldSkipFilter(status)) {
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
    if (shouldSkipFilter(owner)) {
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

    const lowerSearchText = toLower(searchText);

    return tasks.filter(task => {
        const name = toLower(task.name);
        const description = toLower(task.description);
        return name.includes(lowerSearchText) || description.includes(lowerSearchText);
    });
}
