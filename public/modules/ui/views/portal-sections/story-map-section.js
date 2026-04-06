// @ts-check
/**
 * Story Map Section — Stories(wiki) + マイルストーン + スプリントを階層表示
 */

const HORIZON_DEPTH = { northstar: 0, annual: 1, quarter: 2, month: 3, sprint: 4 };
const HORIZON_LABEL = { northstar: 'NS', annual: 'Annual', quarter: 'Q', month: 'Month', sprint: 'Sprint' };

/**
 * @param {Object} storyMap - { stories: [], milestones: [], sprints: [] }
 * @param {Function} escapeHtml
 * @returns {string} HTML
 */
export function renderStoryMapSection(storyMap, { escapeHtml }) {
    const stories = storyMap?.stories || [];
    const milestones = storyMap?.milestones || [];
    const sprints = storyMap?.sprints || [];

    if (!stories.length && !milestones.length && !sprints.length) {
        return '<div class="portal-vl-empty">ストーリー・マイルストーンなし</div>';
    }

    let html = '<div class="portal-story-tree">';

    // Stories from wiki (Frame/Story/Event hierarchy)
    if (stories.length) {
        for (const s of stories) {
            const depth = HORIZON_DEPTH[s.horizon] ?? 0;
            const label = HORIZON_LABEL[s.horizon] || s.horizon;
            html += `
                <div class="portal-story-node" data-depth="${depth}" style="padding-left:${12 + depth * 20}px">
                    <span class="portal-story-status active"></span>
                    <span class="portal-story-horizon">${label}</span>
                    <span>${escapeHtml(s.name)}</span>
                    ${s.enemy ? `<span style="font-size:10px;color:var(--text-tertiary,rgba(255,255,255,0.4));margin-left:auto">vs ${escapeHtml(s.enemy.substring(0, 40))}</span>` : ''}
                </div>
            `;
        }
    }

    // NocoDB Milestones (if any)
    if (milestones.length) {
        for (const m of milestones) {
            const pct = Math.min(100, Math.max(0, m.progress || 0));
            const statusClass = m.status === '完了' ? 'completed' : m.status === '進行中' ? 'active' : 'pending';
            html += `
                <div class="portal-story-node" data-depth="2" style="padding-left:${12 + 2 * 20}px">
                    <span class="portal-story-status ${statusClass}"></span>
                    <span class="portal-story-horizon">MS</span>
                    <span>${escapeHtml(m.name)}</span>
                    <div class="portal-story-progress">
                        <div class="portal-story-progress-fill" style="width:${pct}%"></div>
                    </div>
                </div>
            `;
        }
    }

    // Current sprint
    if (sprints.length > 0) {
        const current = sprints[0];
        html += `
            <div class="portal-story-node" data-depth="3" style="padding-left:${12 + 3 * 20}px">
                <span class="portal-story-status active"></span>
                <span class="portal-story-horizon">Sprint</span>
                <span>${escapeHtml(current.period || 'Current Sprint')}</span>
                ${current.goals ? `<span style="font-size:11px;color:var(--text-secondary);margin-left:8px">${escapeHtml(current.goals.substring(0, 60))}${current.goals.length > 60 ? '...' : ''}</span>` : ''}
            </div>
        `;
    }

    html += '</div>';
    return html;
}
