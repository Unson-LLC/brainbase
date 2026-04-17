// @ts-check
/**
 * Team Section — メンバーGrid + RACI + タスク数
 */

/**
 * @param {Array} members
 * @param {Object} tasks - { items: [] }
 * @param {{ escapeHtml: (value: any) => string }} helpers
 * @returns {string} HTML
 */
export function renderTeamSection(members, tasks, { escapeHtml }) {
    if (!members || !members.length) {
        return '<div class="portal-vl-empty">メンバー情報なし</div>';
    }

    const taskItems = tasks?.items || [];

    const cards = members.map(m => {
        const activeTasks = taskItems.filter(t => t.assignee === m.name && t.status !== '完了').length;
        const blockedTasks = taskItems.filter(t => t.assignee === m.name && (t.status === 'ブロック' || t.status === '保留')).length;
        const raciLabel = (m.raciRoles || []).map(r => r.roleCode).join(', ');

        return `
            <div class="portal-team-card">
                <div class="portal-team-name">${escapeHtml(m.name)}</div>
                <div class="portal-team-role">${escapeHtml(m.role)}${raciLabel ? ` / ${escapeHtml(raciLabel)}` : ''}</div>
                <div class="portal-team-stats">
                    <span class="portal-team-stat">${activeTasks}件</span>
                    ${blockedTasks > 0 ? `<span class="portal-team-stat blocked">${blockedTasks} blocked</span>` : ''}
                </div>
            </div>
        `;
    }).join('');

    return `<div class="portal-team-grid">${cards}</div>`;
}
