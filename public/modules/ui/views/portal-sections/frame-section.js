// @ts-check
/**
 * Frame Section — 「会社が今どの世界を生きているか」
 * 3つのキー情報（誰に/何を/どう届ける）をカード表示 + 折りたたみ全文
 */

/**
 * @param {Object} frame - { title, content, available }
 * @param {Function} renderMarkdown
 * @param {Function} escapeHtml
 * @returns {string} HTML
 */
export function renderFrameSection(frame, { renderMarkdown, escapeHtml }) {
    if (!frame?.available) {
        return '<div class="portal-frame-summary" style="opacity:0.5">Frame未設定（project.md / frame.md が見つかりません）</div>';
    }

    const raw = frame.content || '';

    // Strip YAML frontmatter (--- ... ---)
    const body = raw.replace(/^---[\s\S]*?---\s*\n?/, '').trim();

    // Extract YAML frontmatter fields for structured display
    const frontmatter = _parseFrontmatter(raw);
    const hasStructured = frontmatter.user_ecosystem || frontmatter.value_hypothesis;

    // Extract first meaningful paragraph as summary (skip headings)
    const bodyLines = body.split('\n').filter(l => l.trim());
    const summaryLines = [];
    for (const l of bodyLines) {
        if (l.startsWith('#')) continue;
        summaryLines.push(l.trim());
        if (summaryLines.length >= 2) break;
    }
    const summary = summaryLines.join(' ');

    let html = '';

    // Structured frame info (from YAML frontmatter)
    if (hasStructured) {
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">';
        if (frontmatter.user_ecosystem) {
            html += _frameChip('WHO', frontmatter.user_ecosystem, '#818cf8', escapeHtml);
        }
        if (frontmatter.value_hypothesis) {
            html += _frameChip('WHAT', frontmatter.value_hypothesis, '#34d399', escapeHtml);
        }
        if (frontmatter.pricing_delivery) {
            html += _frameChip('HOW', frontmatter.pricing_delivery, '#fbbf24', escapeHtml);
        }
        html += '</div>';
    }

    // Summary text
    if (summary) {
        html += `<div class="portal-frame-summary">${escapeHtml(summary)}</div>`;
    }

    // Full content (collapsible, without frontmatter)
    if (body.length > summary.length + 20) {
        html += `
            <details>
                <summary style="font-size:11px;color:var(--text-secondary);cursor:pointer;margin:4px 0">全文を表示</summary>
                <div class="portal-frame-full">${renderMarkdown(body)}</div>
            </details>
        `;
    }

    return html;
}

function _frameChip(label, value, color, escapeHtml) {
    return `<div style="flex:1;min-width:180px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:8px 10px">
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
