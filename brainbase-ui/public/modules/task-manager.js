/**
 * タスク管理のロジック
 * DRY: app.jsから抽出したタスク操作関数
 */

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const PRIORITY_LIST = ['high', 'medium', 'low'];

/**
 * フォーカスすべきタスクを取得
 * Priority: in-progress > high priority with due > high priority > medium/normal > exclude low
 * @param {Array} tasks - タスク一覧
 * @returns {Object|null} フォーカスタスクまたはnull
 */
export function getFocusTask(tasks) {
  // Filter by owner: show only tasks assigned to 佐藤圭吾
  const activeTasks = tasks.filter(t =>
    t.status !== 'done' &&
    (t.owner === '佐藤圭吾' || !t.owner) // Show tasks with no owner assigned as well
  );

  if (activeTasks.length === 0) return null;

  // 1. in-progress tasks first
  const inProgress = activeTasks.find(t => t.status === 'in-progress');
  if (inProgress) return inProgress;

  // 2. High priority with nearest due date
  const highWithDue = activeTasks
    .filter(t => t.priority === 'high' && t.due)
    .sort((a, b) => new Date(a.due) - new Date(b.due));
  if (highWithDue.length > 0) return highWithDue[0];

  // 3. Any high priority
  const high = activeTasks.find(t => t.priority === 'high');
  if (high) return high;

  // 4. First non-low priority todo (low = deferred/backlog)
  const nonLow = activeTasks.filter(t => t.priority !== 'low');
  if (nonLow.length > 0) return nonLow[0];

  // 5. Return any task if only low priority remains
  return activeTasks[0] || null;
}

/**
 * タスクを優先度順にソート
 * @param {Array} tasks - タスク一覧
 * @returns {Array} ソート済みタスク
 */
export function sortTasksByPriority(tasks) {
  return [...tasks].sort((a, b) => {
    const pA = PRIORITY_ORDER[a.priority] ?? 1; // default to medium
    const pB = PRIORITY_ORDER[b.priority] ?? 1;
    if (pA !== pB) return pA - pB;

    // Same priority: sort by due date
    if (a.due && b.due) return new Date(a.due) - new Date(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    return 0;
  });
}

/**
 * タスクをフィルタリング
 * @param {Array} tasks - タスク一覧
 * @param {string} filterText - フィルタテキスト
 * @returns {Array} フィルタ済みタスク
 */
export function filterTasks(tasks, filterText) {
  if (!filterText) return tasks;

  const lower = filterText.toLowerCase();
  return tasks.filter(t =>
    t.name?.toLowerCase().includes(lower) ||
    t.project?.toLowerCase().includes(lower)
  );
}

/**
 * 次の優先度を取得（defer用）
 * @param {string} currentPriority - 現在の優先度
 * @returns {string} 次の優先度
 */
export function getNextPriority(currentPriority) {
  const currentIndex = PRIORITY_LIST.indexOf(currentPriority || 'medium');
  const effectiveIndex = currentIndex === -1 ? 1 : currentIndex; // default to medium
  return PRIORITY_LIST[Math.min(effectiveIndex + 1, PRIORITY_LIST.length - 1)];
}
