/**
 * 右パネルのHTMLレンダリング
 * フォーカスタスク、次のタスク、タイムラインのテンプレート生成
 */

/**
 * フォーカスタスクのHTMLを生成
 * @param {Object|null} task - タスクオブジェクト
 * @returns {string} HTML文字列
 */
export function renderFocusTaskHTML(task) {
  if (!task) {
    return `
      <div class="focus-empty">
        <i data-lucide="inbox"></i>
        <p>タスクなし</p>
      </div>
    `;
  }

  const statusClass = task.status || 'todo';
  const priorityBadge = task.priority
    ? `<span class="focus-priority ${task.priority}">${task.priority}</span>`
    : '';
  const dueBadge = task.due
    ? `<span class="focus-due">${task.due}</span>`
    : '';

  return `
    <div class="focus-task-card" data-task-id="${task.id}">
      <div class="focus-task-header">
        <span class="focus-task-status ${statusClass}">${statusClass}</span>
        ${priorityBadge}
      </div>
      <div class="focus-task-title">${task.name}</div>
      <div class="focus-task-meta">
        <span class="focus-project">${task.project || 'general'}</span>
        ${dueBadge}
      </div>
      <div class="focus-task-actions">
        <button class="focus-action-btn complete-btn" data-id="${task.id}" title="Complete">
          <i data-lucide="check-circle"></i>
        </button>
        <button class="focus-action-btn defer-btn" data-id="${task.id}" title="Defer">
          <i data-lucide="clock"></i>
        </button>
        <button class="focus-action-btn start-focus-session-btn" data-id="${task.id}" title="Start Session">
          <i data-lucide="terminal-square"></i>
        </button>
      </div>
    </div>
  `;
}

/**
 * 次のタスクアイテムのHTMLを生成
 * @param {Object} task - タスクオブジェクト
 * @returns {string} HTML文字列
 */
export function renderNextTaskItemHTML(task) {
  const priorityBadge = task.priority
    ? `<span class="next-task-priority ${task.priority}">${task.priority}</span>`
    : '';

  return `
    <div class="next-task-item" data-task-id="${task.id}">
      <div class="next-task-checkbox" data-id="${task.id}">
        <i data-lucide="check"></i>
      </div>
      <div class="next-task-content">
        <div class="next-task-title">${task.name}</div>
        <div class="next-task-meta">
          <span class="next-task-project">${task.project || 'general'}</span>
          ${priorityBadge}
        </div>
      </div>
      <div class="next-task-actions">
        <button class="next-task-action start-task-btn" data-id="${task.id}" title="Start Session">
          <i data-lucide="terminal-square"></i>
        </button>
        <button class="next-task-action edit-task-btn" data-id="${task.id}" title="Edit">
          <i data-lucide="edit-2"></i>
        </button>
        <button class="next-task-action delete-task-btn" data-id="${task.id}" title="Delete">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>
  `;
}

/**
 * タイムラインイベントのHTMLを生成
 * @param {Object} event - イベントオブジェクト
 * @returns {string} HTML文字列
 */
export function renderTimelineEventHTML(event) {
  const timeLabel = event.allDay ? '終日' : (event.time || '');
  const durationLabel = event.duration ? ` (${event.duration})` : '';

  return `
    <div class="timeline-event">
      <div class="timeline-time">${timeLabel}${durationLabel}</div>
      <div class="timeline-title">${event.title}</div>
    </div>
  `;
}
