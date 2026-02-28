/**
 * タイムライン表示のロジック
 */

/**
 * イベントを開始時刻でソート
 * @param {Array} events - イベント配列
 * @returns {Array} ソート済み配列（元配列は変更しない）
 */
export function sortEventsByTime(events) {
  return [...events].sort((a, b) => {
    const timeA = a.start || '00:00';
    const timeB = b.start || '00:00';
    return timeA.localeCompare(timeB);
  });
}

/**
 * 現在時刻を HH:MM 形式で取得
 * @returns {string}
 */
export function getCurrentTimeStr() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * タイムラインHTMLを生成
 * @param {Array} events - イベント配列
 * @param {string} currentTime - 現在時刻 (HH:MM)
 * @returns {string} HTML文字列
 */
export function formatTimelineHTML(events, currentTime) {
  if (!events || events.length === 0) {
    return '<div class="timeline-empty">予定なし</div>';
  }

  // Separate timed events from tasks
  const timedEvents = events.filter(e => e.start);
  const tasks = events.filter(e => !e.start && e.isTask);

  const sortedEvents = sortEventsByTime(timedEvents);
  let html = '<div class="timeline">';
  let nowInserted = false;

  sortedEvents.forEach((event) => {
    const eventTime = event.start || '00:00';

    // Insert "now" marker before future events
    if (!nowInserted && !event.allDay && eventTime > currentTime) {
      html += `<div class="timeline-now"><span class="timeline-now-label">現在 ${currentTime}</span></div>`;
      nowInserted = true;
    }

    // Determine if this is the current event
    const isCurrent = !event.allDay &&
      eventTime <= currentTime &&
      (event.end ? event.end > currentTime : true);

    const currentClass = isCurrent ? ' current is-current' : '';
    const workTimeClass = event.isWorkTime ? ' is-worktime' : '';
    const timeLabel = event.allDay ? '終日' : (event.start + (event.end ? '-' + event.end : ''));
    const title = event.title || event.task || '';

    html += `
      <div class="timeline-item is-event${currentClass}${workTimeClass}">
        <div class="timeline-marker"></div>
        <span class="timeline-time">${timeLabel}</span>
        <span class="timeline-content">${title}</span>
      </div>
    `;
  });

  // Insert now marker at end if all events are past
  if (!nowInserted) {
    html += `<div class="timeline-now"><span class="timeline-now-label">現在 ${currentTime}</span></div>`;
  }

  // Add today's tasks section if any
  if (tasks.length > 0) {
    html += '<div class="timeline-tasks-section">';
    html += '<div class="timeline-tasks-header">今日のタスク</div>';
    tasks.forEach((task) => {
      html += `
        <div class="timeline-item is-task">
          <div class="timeline-marker task-marker"></div>
          <span class="timeline-content">${task.task}</span>
        </div>
      `;
    });
    html += '</div>';
  }

  html += '</div>';
  return html;
}
