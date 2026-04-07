// @ts-check
/**
 * Story Map Section — Story統一モデル表示
 * status/period/progress対応。完了Storyはグレーアウト。
 */

const HORIZON_DEPTH = { northstar: 0, annual: 1, quarter: 2, month: 3, sprint: 4 };
const HORIZON_LABEL = { northstar: 'NS', annual: 'Annual', quarter: 'Q', month: 'Month', sprint: 'Sprint' };
const VIEW_EMOJI = { user: '👤', dev: '⚙️', business: '💼' };
const STATUS_STYLE = {
    active: { dot: 'active', opacity: '1', textDecoration: 'none' },
    draft: { dot: 'pending', opacity: '0.5', textDecoration: 'none' },
    completed: { dot: 'completed', opacity: '0.6', textDecoration: 'line-through' },
    archived: { dot: 'completed', opacity: '0.3', textDecoration: 'line-through' }
};

/**
 * @param {Object} storyMap - { stories: [], milestones: [], sprints: [] }
 * @param {Function} escapeHtml
 * @returns {string} HTML
 */
export function renderStoryMapSection(storyMap, { escapeHtml }) {
    const stories = storyMap?.stories || [];
    const milestones = (storyMap?.milestones || []).filter(m => m.name);
    const sprints = storyMap?.sprints || [];

    if (!stories.length && !milestones.length && !sprints.length) {
        return '<div class="portal-vl-empty">ストーリーなし</div>';
    }

    // Separate active/draft vs completed
    const activeStories = stories.filter(s => s.status !== 'completed' && s.status !== 'archived');
    const completedStories = stories.filter(s => s.status === 'completed' || s.status === 'archived');

    let html = '<div class="portal-story-tree">';

    // Active & draft stories
    for (const s of activeStories) {
        html += _renderStoryNode(s, escapeHtml);
    }

    // Unlinked milestones (no story_id)
    for (const m of milestones) {
        html += _renderMilestoneNode(m, escapeHtml);
    }

    // Current sprint
    if (sprints.length > 0) {
        html += _renderSprintNode(sprints[0], escapeHtml);
    }

    // Completed stories (collapsible)
    if (completedStories.length > 0) {
        html += `
            <details style="margin-top:8px">
                <summary style="font-size:11px;color:var(--text-tertiary,rgba(255,255,255,0.3));cursor:pointer;padding:4px 0">
                    完了したStory (${completedStories.length})
                </summary>
                <div>`;
        for (const s of completedStories) {
            html += _renderStoryNode(s, escapeHtml);
        }
        html += '</div></details>';
    }

    html += '</div>';
    return html;
}

function _renderStoryNode(s, escapeHtml) {
    const depth = HORIZON_DEPTH[s.horizon] ?? 0;
    const label = HORIZON_LABEL[s.horizon] || s.horizon || '?';
    const viewEmoji = VIEW_EMOJI[s.view] || '';
    const style = STATUS_STYLE[s.status] || STATUS_STYLE.active;
    const hasDetails = s.enemy || s.criteria || s.beat_map || s.context;
    const detailsId = `story-${(s.story_id || Math.random().toString(36).substr(2, 6)).replace(/[^a-zA-Z0-9]/g, '-')}`;

    // Period label
    const periodLabel = s.period ? ` ${s.period}` : '';

    // Progress bar (from NocoDB merge)
    const progressHtml = s.progress != null ? `
        <div class="portal-story-progress">
            <div class="portal-story-progress-fill" style="width:${Math.min(100, s.progress)}%"></div>
        </div>
        <span style="font-size:10px;color:var(--text-secondary)">${s.progress}%</span>
    ` : '';

    let html = `
        <div class="portal-story-node" data-depth="${depth}" style="padding-left:${12 + depth * 20}px;flex-wrap:wrap;opacity:${style.opacity};${hasDetails ? 'cursor:pointer' : ''}" ${hasDetails ? `onclick="document.getElementById('${detailsId}').toggleAttribute('open')"` : ''}>
            <span class="portal-story-status ${style.dot}"></span>
            <span class="portal-story-horizon">${label}${periodLabel}</span>
            ${viewEmoji ? `<span style="font-size:11px" title="${s.view}">${viewEmoji}</span>` : ''}
            <span style="flex:1;text-decoration:${style.textDecoration}">${escapeHtml(s.name)}</span>
            ${progressHtml}
            ${hasDetails ? '<span style="font-size:9px;color:var(--text-tertiary,rgba(255,255,255,0.3))">▸</span>' : ''}
        </div>
    `;

    if (hasDetails) {
        html += `<details id="${detailsId}" style="padding-left:${50 + depth * 20}px;margin-bottom:6px">
            <summary style="display:none"></summary>
            <div style="font-size:11px;color:var(--text-secondary);line-height:1.6;padding:8px;background:rgba(255,255,255,0.01);border-radius:4px">`;

        if (s.enemy) {
            html += `<div style="margin-bottom:6px"><span style="color:#ef4444;font-weight:600;font-size:10px;text-transform:uppercase">Enemy</span><br>${escapeHtml(s.enemy)}</div>`;
        }

        if (Array.isArray(s.criteria) && s.criteria.length) {
            html += '<div style="margin-bottom:6px"><span style="color:#34d399;font-weight:600;font-size:10px;text-transform:uppercase">Criteria</span>';
            for (const c of s.criteria) {
                const icon = c.type === 'commit' ? '✅' : '📡';
                html += `<div style="padding:2px 0 2px 8px">${icon} <span style="font-size:10px;color:var(--text-tertiary)">${c.type || ''}</span> ${escapeHtml(c.description || '')}</div>`;
            }
            html += '</div>';
        }

        if (s.beat_map && typeof s.beat_map === 'object') {
            html += '<div style="margin-bottom:6px"><span style="color:#818cf8;font-weight:600;font-size:10px;text-transform:uppercase">Beat Map</span>';
            for (const [k, v] of Object.entries(s.beat_map)) {
                html += `<div style="padding:2px 0 2px 8px"><span style="color:var(--text-tertiary);font-weight:500">${escapeHtml(k.toUpperCase())}:</span> ${escapeHtml(v)}</div>`;
            }
            html += '</div>';
        }

        if (s.context) {
            html += `<div style="color:var(--text-tertiary);font-style:italic">${escapeHtml(s.context)}</div>`;
        }

        html += '</div></details>';
    }

    return html;
}

function _renderMilestoneNode(m, escapeHtml) {
    const pct = Math.min(100, Math.max(0, m.progress || 0));
    const statusClass = m.status === 'completed' ? 'completed' : m.status === 'active' ? 'active' : 'pending';
    return `
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

function _renderSprintNode(current, escapeHtml) {
    const hasDetails = current.goals || current.blockers || current.completed;
    const sprintId = `sprint-${(current.period || 'current').replace(/[^a-zA-Z0-9]/g, '-')}`;

    let html = `
        <div class="portal-story-node" data-depth="3" style="padding-left:${12 + 3 * 20}px;${hasDetails ? 'cursor:pointer' : ''}" ${hasDetails ? `onclick="document.getElementById('${sprintId}').toggleAttribute('open')"` : ''}>
            <span class="portal-story-status active"></span>
            <span class="portal-story-horizon">Sprint</span>
            <span style="flex:1">${escapeHtml(current.period || 'Current Sprint')}</span>
            ${hasDetails ? '<span style="font-size:9px;color:var(--text-tertiary,rgba(255,255,255,0.3))">▸</span>' : ''}
        </div>
    `;

    if (hasDetails) {
        html += `<details id="${sprintId}" style="padding-left:${50 + 3 * 20}px;margin-bottom:4px">
            <summary style="display:none"></summary>
            <div style="font-size:11px;color:var(--text-secondary);line-height:1.6;padding:8px;background:rgba(255,255,255,0.01);border-radius:4px">`;
        if (current.goals) html += `<div style="margin-bottom:4px"><span style="color:#38bdf8;font-weight:500">目標:</span> ${escapeHtml(current.goals)}</div>`;
        if (current.completed) html += `<div style="margin-bottom:4px"><span style="color:#34d399;font-weight:500">完了:</span> ${escapeHtml(current.completed.substring(0, 200))}</div>`;
        if (current.blockers) html += `<div style="margin-bottom:4px"><span style="color:#ef4444;font-weight:500">ブロッカー:</span> ${escapeHtml(current.blockers.substring(0, 200))}</div>`;
        if (current.learnings) html += `<div><span style="color:#fbbf24;font-weight:500">学び:</span> ${escapeHtml(current.learnings.substring(0, 200))}</div>`;
        html += '</div></details>';
    }

    return html;
}
