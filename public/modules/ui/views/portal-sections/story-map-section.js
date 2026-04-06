// @ts-check
/**
 * Story Map Section — Stories + マイルストーン + スプリント階層表示
 * クリックでcriteria/enemy/beat_mapをドリルダウン
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

    // Stories from wiki
    for (const s of stories) {
        const depth = HORIZON_DEPTH[s.horizon] ?? 0;
        const label = HORIZON_LABEL[s.horizon] || s.horizon;
        const viewLabel = s.view ? { user: '👤', dev: '⚙️', business: '💼' }[s.view] || '' : '';
        const hasDetails = s.enemy || s.criteria || s.beat_map || s.context;
        const detailsId = `story-${(s.story_id || '').replace(/[^a-zA-Z0-9]/g, '-')}`;

        html += `
            <div class="portal-story-node" data-depth="${depth}" style="padding-left:${12 + depth * 20}px;flex-wrap:wrap;${hasDetails ? 'cursor:pointer' : ''}" ${hasDetails ? `onclick="document.getElementById('${detailsId}').toggleAttribute('open')"` : ''}>
                <span class="portal-story-status active"></span>
                <span class="portal-story-horizon">${label}</span>
                ${viewLabel ? `<span style="font-size:11px" title="${s.view}">${viewLabel}</span>` : ''}
                <span style="flex:1">${escapeHtml(s.name)}</span>
                ${hasDetails ? '<span style="font-size:9px;color:var(--text-tertiary,rgba(255,255,255,0.3))">▸</span>' : ''}
            </div>
        `;

        if (hasDetails) {
            html += `<details id="${detailsId}" style="padding-left:${50 + depth * 20}px;margin-bottom:6px">
                <summary style="display:none"></summary>
                <div style="font-size:11px;color:var(--text-secondary);line-height:1.6;padding:6px 0;background:rgba(255,255,255,0.01);border-radius:4px;padding:8px">`;

            if (s.enemy) {
                html += `<div style="margin-bottom:6px"><span style="color:#ef4444;font-weight:600;font-size:10px;text-transform:uppercase">Enemy</span><br>${escapeHtml(s.enemy)}</div>`;
            }

            // Criteria (array of {type, description})
            if (Array.isArray(s.criteria) && s.criteria.length) {
                html += '<div style="margin-bottom:6px"><span style="color:#34d399;font-weight:600;font-size:10px;text-transform:uppercase">Criteria</span>';
                for (const c of s.criteria) {
                    const icon = c.type === 'commit' ? '✅' : '📡';
                    html += `<div style="padding:2px 0 2px 8px">${icon} <span style="font-size:10px;color:var(--text-tertiary)">${c.type || ''}</span> ${escapeHtml(c.description || '')}</div>`;
                }
                html += '</div>';
            } else if (typeof s.criteria === 'string') {
                html += `<div style="margin-bottom:6px"><span style="color:#34d399;font-weight:600;font-size:10px;text-transform:uppercase">Criteria</span><br>${escapeHtml(s.criteria)}</div>`;
            }

            // Beat Map (object: {q1: "...", q2: "..."})
            if (s.beat_map && typeof s.beat_map === 'object') {
                html += '<div style="margin-bottom:6px"><span style="color:#818cf8;font-weight:600;font-size:10px;text-transform:uppercase">Beat Map</span>';
                for (const [k, v] of Object.entries(s.beat_map)) {
                    html += `<div style="padding:2px 0 2px 8px"><span style="color:var(--text-tertiary);font-weight:500">${escapeHtml(k.toUpperCase())}:</span> ${escapeHtml(v)}</div>`;
                }
                html += '</div>';
            }

            // Context (prose between YAML blocks)
            if (s.context) {
                html += `<div style="margin-top:4px;color:var(--text-tertiary);font-style:italic">${escapeHtml(s.context)}</div>`;
            }

            html += '</div></details>';
        }
    }

    // NocoDB Milestones
    for (const m of milestones) {
        const pct = Math.min(100, Math.max(0, m.progress || 0));
        const statusClass = m.status === '完了' ? 'completed' : m.status === '進行中' ? 'active' : 'pending';
        html += `
            <div class="portal-story-node" data-depth="2" style="padding-left:${12 + 2 * 20}px">
                <span class="portal-story-status ${statusClass}"></span>
                <span class="portal-story-horizon">MS</span>
                <span style="flex:1">${escapeHtml(m.name)}</span>
                <div class="portal-story-progress">
                    <div class="portal-story-progress-fill" style="width:${pct}%"></div>
                </div>
            </div>
        `;
    }

    // Current sprint with drilldown
    if (sprints.length > 0) {
        const current = sprints[0];
        const sprintId = `sprint-${(current.period || 'current').replace(/[^a-zA-Z0-9]/g, '-')}`;
        const hasSprintDetails = current.goals || current.blockers || current.completed;

        html += `
            <div class="portal-story-node" data-depth="3" style="padding-left:${12 + 3 * 20}px;${hasSprintDetails ? 'cursor:pointer' : ''}" ${hasSprintDetails ? `onclick="document.getElementById('${sprintId}').toggleAttribute('open')"` : ''}>
                <span class="portal-story-status active"></span>
                <span class="portal-story-horizon">Sprint</span>
                <span style="flex:1">${escapeHtml(current.period || 'Current Sprint')}</span>
                ${hasSprintDetails ? '<span style="font-size:10px;color:var(--text-tertiary,rgba(255,255,255,0.3))">▸</span>' : ''}
            </div>
        `;

        if (hasSprintDetails) {
            html += `<details id="${sprintId}" style="padding-left:${50 + 3 * 20}px;margin-bottom:4px">
                <summary style="display:none"></summary>
                <div style="font-size:11px;color:var(--text-secondary);line-height:1.6;padding:4px 0">`;
            if (current.goals) html += `<div style="margin-bottom:4px"><span style="color:#38bdf8;font-weight:500">目標:</span> ${escapeHtml(current.goals)}</div>`;
            if (current.completed) html += `<div style="margin-bottom:4px"><span style="color:#34d399;font-weight:500">完了:</span> ${escapeHtml(current.completed.substring(0, 200))}</div>`;
            if (current.blockers) html += `<div style="margin-bottom:4px"><span style="color:#ef4444;font-weight:500">ブロッカー:</span> ${escapeHtml(current.blockers.substring(0, 200))}</div>`;
            if (current.learnings) html += `<div><span style="color:#fbbf24;font-weight:500">学び:</span> ${escapeHtml(current.learnings.substring(0, 200))}</div>`;
            html += '</div></details>';
        }
    }

    html += '</div>';
    return html;
}
