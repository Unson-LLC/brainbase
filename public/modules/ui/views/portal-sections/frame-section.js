// @ts-check
/**
 * Frame Section — 「会社が今どの世界を生きているか」
 * markdown要約 + 折りたたみ全文
 */

/**
 * @param {Object} frame - { title, content, available }
 * @param {Function} renderMarkdown
 * @param {Function} escapeHtml
 * @returns {string} HTML
 */
export function renderFrameSection(frame, { renderMarkdown, escapeHtml }) {
    if (!frame?.available) {
        return `<div class="portal-frame-summary" style="opacity:0.5">Frame未設定（project.md / frame.md が見つかりません）</div>`;
    }

    // Extract first paragraph as summary
    const lines = (frame.content || '').split('\n').filter(l => l.trim());
    const summaryLine = lines.find(l => !l.startsWith('#') && !l.startsWith('---')) || lines[0] || '';
    const hasFull = frame.content && frame.content.length > summaryLine.length + 10;

    return `
        <div class="portal-frame-summary">${escapeHtml(summaryLine)}</div>
        ${hasFull ? `
            <details>
                <summary style="font-size:11px;color:var(--text-secondary);cursor:pointer;margin:4px 0">全文を表示</summary>
                <div class="portal-frame-full">${renderMarkdown(frame.content)}</div>
            </details>
        ` : ''}
    `;
}
