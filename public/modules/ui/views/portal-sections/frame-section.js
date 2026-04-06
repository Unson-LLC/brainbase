// @ts-check
/**
 * Frame Section — 「会社が今どの世界を生きているか」
 * 複数Frame対応: frames配列があればタブ/カード形式で表示
 * 単一Frameの場合はWHO/WHAT/HOWチップ表示
 */

/**
 * @param {Object} frame - { title, content, available, frames: [] }
 * @param {Object} direction - { title, content, available }
 * @param {Function} renderMarkdown
 * @param {Function} escapeHtml
 * @returns {string} HTML
 */
export function renderFrameSection(frame, direction, { renderMarkdown, escapeHtml }) {
    if (!frame?.available && !direction?.available) {
        return '<div class="portal-frame-summary" style="opacity:0.5">Frame未設定</div>';
    }

    const frames = frame?.frames || [];

    // Multiple frames → card layout
    if (frames.length > 1) {
        return _renderMultiFrame(frames, frame, direction, { renderMarkdown, escapeHtml });
    }

    // Single frame → chip layout (existing)
    return _renderSingleFrame(frame, direction, { renderMarkdown, escapeHtml });
}

function _renderMultiFrame(frames, frame, direction, { renderMarkdown, escapeHtml }) {
    let html = '<div style="display:flex;flex-direction:column;gap:12px">';

    for (const f of frames) {
        const name = f.name || f.frame_id || 'Frame';
        html += `
            <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:12px">
                <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:8px">${escapeHtml(name)}</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                    ${f.user_ecosystem ? _chip('WHO', f.user_ecosystem, '#818cf8', escapeHtml) : ''}
                    ${f.value_hypothesis ? _chip('WHAT', f.value_hypothesis, '#34d399', escapeHtml) : ''}
                    ${f.pricing_delivery ? _chip('HOW', f.pricing_delivery, '#fbbf24', escapeHtml) : ''}
                </div>
            </div>
        `;
    }

    html += '</div>';

    // Drilldown: full frame.md content
    const raw = frame?.content || '';
    const body = raw.replace(/^---[\s\S]*?---\s*\n?/, '').trim();
    // Extract prose (non-yaml-block, non-heading-only parts)
    const prose = body.split('\n').filter(l => !l.startsWith('```') && l.trim()).join('\n');
    if (prose.length > 50) {
        html += `
            <details style="margin-top:6px">
                <summary style="font-size:11px;color:var(--text-secondary);cursor:pointer">Frame全文</summary>
                <div class="portal-frame-full">${renderMarkdown(body)}</div>
            </details>
        `;
    }

    // Drilldown: project.md
    if (direction?.available && direction.content !== frame?.content) {
        const dirBody = (direction.content || '').replace(/^---[\s\S]*?---\s*\n?/, '').trim();
        if (dirBody) {
            html += `
                <details style="margin-top:4px">
                    <summary style="font-size:11px;color:var(--text-secondary);cursor:pointer">戦略骨子（${escapeHtml(direction.title || 'project.md')}）</summary>
                    <div class="portal-frame-full">${renderMarkdown(dirBody)}</div>
                </details>
            `;
        }
    }

    return html;
}

function _renderSingleFrame(frame, direction, { renderMarkdown, escapeHtml }) {
    const source = frame?.available ? frame : direction;
    const raw = source.content || '';
    const body = raw.replace(/^---[\s\S]*?---\s*\n?/, '').trim();
    const frontmatter = _parseFrontmatter(raw);
    const singleFrame = (frame?.frames || [])[0] || frontmatter;
    const hasStructured = singleFrame.user_ecosystem || singleFrame.value_hypothesis;

    const bodyLines = body.split('\n').filter(l => l.trim());
    const summaryLines = [];
    for (const l of bodyLines) {
        if (l.startsWith('#')) continue;
        summaryLines.push(l.trim());
        if (summaryLines.length >= 2) break;
    }
    const summary = summaryLines.join(' ');

    let html = '';

    if (hasStructured) {
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">';
        if (singleFrame.user_ecosystem) html += _chip('WHO', singleFrame.user_ecosystem, '#818cf8', escapeHtml);
        if (singleFrame.value_hypothesis) html += _chip('WHAT', singleFrame.value_hypothesis, '#34d399', escapeHtml);
        if (singleFrame.pricing_delivery) html += _chip('HOW', singleFrame.pricing_delivery, '#fbbf24', escapeHtml);
        html += '</div>';
    }

    if (summary) {
        html += `<div class="portal-frame-summary">${escapeHtml(summary)}</div>`;
    }

    if (body.length > summary.length + 20) {
        html += `
            <details style="margin-top:4px">
                <summary style="font-size:11px;color:var(--text-secondary);cursor:pointer">Frame全文</summary>
                <div class="portal-frame-full">${renderMarkdown(body)}</div>
            </details>
        `;
    }

    if (frame?.available && direction?.available && direction.content !== frame.content) {
        const dirBody = (direction.content || '').replace(/^---[\s\S]*?---\s*\n?/, '').trim();
        if (dirBody) {
            html += `
                <details style="margin-top:4px">
                    <summary style="font-size:11px;color:var(--text-secondary);cursor:pointer">戦略骨子（${escapeHtml(direction.title || 'project.md')}）</summary>
                    <div class="portal-frame-full">${renderMarkdown(dirBody)}</div>
                </details>
            `;
        }
    }

    return html;
}

function _chip(label, value, color, escapeHtml) {
    return `<div style="flex:1;min-width:140px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:6px 8px">
        <div style="font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:${color};margin-bottom:2px">${label}</div>
        <div style="font-size:11px;color:var(--text-primary);line-height:1.4">${escapeHtml(value)}</div>
    </div>`;
}

function _parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const result = {};
    for (const line of match[1].split('\n')) {
        const m = line.match(/^(\w[\w_]*)\s*:\s*"?(.+?)"?\s*$/);
        if (m) result[m[1]] = m[2];
    }
    return result;
}
