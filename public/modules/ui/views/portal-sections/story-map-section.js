// @ts-check
/**
 * Story Map Section — マイルストーン + スプリントを階層表示
 */

/**
 * @param {Object} storyMap - { milestones: [], sprints: [] }
 * @param {Function} escapeHtml
 * @returns {string} HTML
 */
export function renderStoryMapSection(storyMap, { escapeHtml }) {
    const milestones = storyMap?.milestones || [];
    const sprints = storyMap?.sprints || [];

    if (!milestones.length && !sprints.length) {
        return '<div class="portal-vl-empty">マイルストーン・スプリントなし</div>';
    }

    let html = '<div class="portal-story-tree">';

    // Milestones as top-level nodes
    for (const m of milestones) {
        const pct = Math.min(100, Math.max(0, m.progress || 0));
        const statusClass = m.status === '完了' ? 'completed' : m.status === '進行中' ? 'active' : 'pending';

        html += `
            <div class="portal-story-node" data-depth="0" style="--depth:0">
                <span class="portal-story-status ${statusClass}"></span>
                <span class="portal-story-horizon">milestone</span>
                <span>${escapeHtml(m.name)}</span>
                <div class="portal-story-progress">
                    <div class="portal-story-progress-fill" style="width:${pct}%"></div>
                </div>
            </div>
        `;
    }

    // Current sprint as child node
    if (sprints.length > 0) {
        const current = sprints[0];
        html += `
            <div class="portal-story-node" data-depth="1" style="--depth:1;padding-left:32px">
                <span class="portal-story-status active"></span>
                <span class="portal-story-horizon">sprint</span>
                <span>${escapeHtml(current.period || 'Current Sprint')}</span>
                ${current.goals ? `<span style="font-size:11px;color:var(--text-secondary);margin-left:8px">${escapeHtml(current.goals.substring(0, 80))}${current.goals.length > 80 ? '...' : ''}</span>` : ''}
            </div>
        `;
    }

    html += '</div>';
    return html;
}
