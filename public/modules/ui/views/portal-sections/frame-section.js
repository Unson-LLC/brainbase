// @ts-check
/**
 * Frame Section — 「会社が今どの世界を生きているか」
 * WHO/WHAT/HOWチップ + project.mdの戦略骨子もドリルダウン可能
 */

/**
 * @param {Object} frame - { title, content, available }
 * @param {Object} direction - { title, content, available } (project.md fallback)
 * @param {Function} renderMarkdown
 * @param {Function} escapeHtml
 * @returns {string} HTML
 */
export function renderFrameSection(frame, direction, { renderMarkdown, escapeHtml }) {
    if (!frame?.available && !direction?.available) {
        return '<div class="portal-frame-summary" style="opacity:0.5">Frame未設定</div>';
    }

    const source = frame?.available ? frame : direction;
    const raw = source.content || '';
    const body = raw.replace(/^---[\s\S]*?---\s*\n?/, '').trim();
    const frontmatter = _parseFrontmatter(raw);
    const hasStructured = frontmatter.user_ecosystem || frontmatter.value_hypothesis;

    // Summary: first non-heading, non-empty lines
    const bodyLines = body.split('\n').filter(l => l.trim());
    const summaryLines = [];
    for (const l of bodyLines) {
        if (l.startsWith('#')) continue;
        summaryLines.push(l.trim());
        if (summaryLines.length >= 2) break;
    }
    const summary = summaryLines.join(' ');

    let html = '';

    // WHO / WHAT / HOW chips
    if (hasStructured) {
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">';
        if (frontmatter.user_ecosystem) html += _chip('WHO', frontmatter.user_ecosystem, '#818cf8', escapeHtml);
        if (frontmatter.value_hypothesis) html += _chip('WHAT', frontmatter.value_hypothesis, '#34d399', escapeHtml);
        if (frontmatter.pricing_delivery) html += _chip('HOW', frontmatter.pricing_delivery, '#fbbf24', escapeHtml);
        html += '</div>';
    }

    // Summary
    if (summary) {
        html += `<div class="portal-frame-summary">${escapeHtml(summary)}</div>`;
    }

    // Drilldown: frame.md full content
    if (body.length > summary.length + 20) {
        html += `
            <details style="margin-top:4px">
                <summary style="font-size:11px;color:var(--text-secondary);cursor:pointer">Frame全文</summary>
                <div class="portal-frame-full">${renderMarkdown(body)}</div>
            </details>
        `;
    }

    // Drilldown: project.md / direction (if different from frame)
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
    return `<div style="flex:1;min-width:160px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:8px 10px">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:${color};margin-bottom:3px">${label}</div>
        <div style="font-size:12px;color:var(--text-primary);line-height:1.4">${escapeHtml(value)}</div>
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
