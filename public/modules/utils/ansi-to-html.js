// @ts-check
/**
 * 軽量 ANSI→HTML コンバータ
 *
 * ターミナルスナップショットのfallback表示用。
 * xterm.jsが使えない場面（snapshot panel等）でANSI色付きテキストを
 * HTMLに変換して色表示する。
 *
 * XSS安全: HTMLエスケープを先に行ってからspan生成。
 * リンク検出: URL・ファイルパスをクリック可能な要素に変換。
 */

// xterm.js default ANSI colors (matches Terminal.options.theme defaults)
const BASIC_COLORS = [
    '#2e3436', // 30 black
    '#cc0000', // 31 red
    '#4e9a06', // 32 green
    '#c4a000', // 33 yellow
    '#3465a4', // 34 blue
    '#75507b', // 35 magenta
    '#06989a', // 36 cyan
    '#d3d7cf', // 37 white
];

const BRIGHT_COLORS = [
    '#555753', // 90 bright black
    '#ef2929', // 91 bright red
    '#8ae234', // 92 bright green
    '#fce94f', // 93 bright yellow
    '#729fcf', // 94 bright blue
    '#ad7fa8', // 95 bright magenta
    '#34e2e2', // 96 bright cyan
    '#eeeeec', // 97 bright white
];

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * 256色パレットからCSS色を返す
 */
function color256(n) {
    if (n < 8) return BASIC_COLORS[n];
    if (n < 16) return BRIGHT_COLORS[n - 8];
    if (n < 232) {
        // 6x6x6 color cube
        const idx = n - 16;
        const r = Math.floor(idx / 36);
        const g = Math.floor((idx % 36) / 6);
        const b = idx % 6;
        const toHex = (v) => (v === 0 ? 0 : 55 + v * 40).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
    // grayscale ramp (232-255)
    const level = 8 + (n - 232) * 10;
    const hex = level.toString(16).padStart(2, '0');
    return `#${hex}${hex}${hex}`;
}

/**
 * ANSI SGRパラメータからstyle文字列を生成
 */
function buildStyle(state) {
    const parts = [];
    const fg = state.reverse ? (state.bgColor || null) : state.color;
    const bg = state.reverse ? (state.color || null) : state.bgColor;
    if (fg) parts.push(`color:${fg}`);
    if (bg) parts.push(`background-color:${bg}`);
    if (state.bold) parts.push('font-weight:bold');
    if (state.dim) parts.push('opacity:0.7');
    if (state.italic) parts.push('font-style:italic');
    if (state.underline) parts.push('text-decoration:underline');
    if (state.strikethrough) parts.push('text-decoration:line-through');
    return parts.join(';');
}

/**
 * ANSIエスケープシーケンス付きテキストをHTML変換
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function ansiToHtml(text) {
    if (!text || typeof text !== 'string') return '';

    // Step 1: 非SGR ANSIシーケンスを除去（カーソル移動、画面クリア等）
    // これらはターミナルエミュレータの制御用で、HTML表示では不要
    let cleaned = text;
    // CSI sequences ending with letters other than 'm' (cursor move, erase, scroll etc.)
    cleaned = cleaned.replace(/\x1b\[\??[0-9;]*[A-HJKSTfhlnr]/g, '');
    // OSC sequences: \x1b] ... (\x07 or \x1b\\) — window title etc.
    cleaned = cleaned.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');
    // Single-character escape sequences (\x1bM, \x1bE etc.) but NOT \x1b[ or \x1b]
    cleaned = cleaned.replace(/\x1b[^[\]]/g, '');

    // Step 2: HTMLエスケープ（XSS防止）
    const escaped = escapeHtml(cleaned);

    // Step 3: ANSIシーケンス(SGR)をHTMLに変換
    // Note: \x1b はHTMLエスケープに影響されない制御文字
    const SGR_RE = /\x1b\[([\d;]*)m/g;
    const state = { color: null, bgColor: null, bold: false, dim: false, italic: false, underline: false, strikethrough: false, reverse: false };
    let result = '';
    let lastIndex = 0;
    let spanOpen = false;
    let match;

    while ((match = SGR_RE.exec(escaped)) !== null) {
        // マッチ前のテキストを追加
        result += escaped.slice(lastIndex, match.index);
        lastIndex = match.index + match[0].length;

        const params = match[1] ? match[1].split(';').map(Number) : [0];

        let i = 0;
        while (i < params.length) {
            const p = params[i];
            if (p === 0) {
                // reset
                if (spanOpen) { result += '</span>'; spanOpen = false; }
                state.color = null;
                state.bgColor = null;
                state.bold = false;
                state.dim = false;
                state.italic = false;
                state.underline = false;
                state.strikethrough = false;
                state.reverse = false;
            } else if (p === 1) {
                state.bold = true;
            } else if (p === 2) {
                state.dim = true;
            } else if (p === 3) {
                state.italic = true;
            } else if (p === 4) {
                state.underline = true;
            } else if (p === 7) {
                state.reverse = true;
            } else if (p === 9) {
                state.strikethrough = true;
            } else if (p === 22) {
                state.bold = false;
                state.dim = false;
            } else if (p === 23) {
                state.italic = false;
            } else if (p === 24) {
                state.underline = false;
            } else if (p === 27) {
                state.reverse = false;
            } else if (p === 29) {
                state.strikethrough = false;
            } else if (p >= 30 && p <= 37) {
                state.color = BASIC_COLORS[p - 30];
            } else if (p === 39) {
                state.color = null;
            } else if (p >= 40 && p <= 47) {
                state.bgColor = BASIC_COLORS[p - 40];
            } else if (p === 49) {
                state.bgColor = null;
            } else if (p >= 90 && p <= 97) {
                state.color = BRIGHT_COLORS[p - 90];
            } else if (p >= 100 && p <= 107) {
                state.bgColor = BRIGHT_COLORS[p - 100];
            } else if (p === 38 && params[i + 1] === 5 && params[i + 2] != null) {
                state.color = color256(params[i + 2]);
                i += 2;
            } else if (p === 48 && params[i + 1] === 5 && params[i + 2] != null) {
                state.bgColor = color256(params[i + 2]);
                i += 2;
            } else if (p === 38 && params[i + 1] === 2 && params[i + 4] != null) {
                state.color = `#${params[i + 2].toString(16).padStart(2, '0')}${params[i + 3].toString(16).padStart(2, '0')}${params[i + 4].toString(16).padStart(2, '0')}`;
                i += 4;
            } else if (p === 48 && params[i + 1] === 2 && params[i + 4] != null) {
                state.bgColor = `#${params[i + 2].toString(16).padStart(2, '0')}${params[i + 3].toString(16).padStart(2, '0')}${params[i + 4].toString(16).padStart(2, '0')}`;
                i += 4;
            }
            i++;
        }

        // 現在のスタイルに応じてspanを開く
        const style = buildStyle(state);
        if (style) {
            if (spanOpen) result += '</span>';
            result += `<span style="${style}">`;
            spanOpen = true;
        }
    }

    // 残りのテキスト
    result += escaped.slice(lastIndex);
    if (spanOpen) result += '</span>';

    return linkifyHtml(result);
}

// --- リンク検出（URL・ファイルパス） ---

const URL_RE = /https?:\/\/[^\s<>&"']+/g;

const FILE_EXTS = 'markdown|mdx|tsx|jsx|json|yaml|yml|toml|html|css|txt|svg|xml|ini|cfg|env|sql|bash|md|mjs|cjs|js|ts|py|rb|go|rs|java|kt|swift|php|cpp|hpp|cc|sh|zsh|c|h|log';
// パスに / を含むことを必須にして誤検出を防ぐ（gmail.c 等）
const FILE_PATH_RE = new RegExp(
    '((?:~\\/|\\.{1,2}\\/|\\/)[a-zA-Z0-9_][a-zA-Z0-9_/.\\-]*\\.(?:' + FILE_EXTS + ')|[a-zA-Z0-9_][a-zA-Z0-9_\\-]*\\/[a-zA-Z0-9_/.\\-]*\\.(?:' + FILE_EXTS + '))(?::([0-9]+))?',
    'g'
);

function linkifyHtml(html) {
    const TAG_RE = /<[^>]+>/g;
    const parts = [];
    let lastIdx = 0;
    let tagMatch;

    while ((tagMatch = TAG_RE.exec(html)) !== null) {
        if (tagMatch.index > lastIdx) {
            parts.push({ type: 'text', value: html.slice(lastIdx, tagMatch.index) });
        }
        parts.push({ type: 'tag', value: tagMatch[0] });
        lastIdx = tagMatch.index + tagMatch[0].length;
    }
    if (lastIdx < html.length) {
        parts.push({ type: 'text', value: html.slice(lastIdx) });
    }

    return parts.map(part => {
        if (part.type === 'tag') return part.value;
        return linkifyText(part.value);
    }).join('');
}

function linkifyText(text) {
    const matches = [];

    URL_RE.lastIndex = 0;
    let m;
    while ((m = URL_RE.exec(text)) !== null) {
        let url = m[0].replace(/[),.:;!?]+$/, '');
        matches.push({ start: m.index, end: m.index + url.length, type: 'url', value: url });
    }

    FILE_PATH_RE.lastIndex = 0;
    while ((m = FILE_PATH_RE.exec(text)) !== null) {
        const filePath = m[1];
        const line = m[2] || '';
        const start = m.index;
        const end = m.index + m[0].length;
        if (matches.some(existing => start >= existing.start && start < existing.end)) continue;
        matches.push({ start, end, type: 'file', value: filePath, line });
    }

    if (!matches.length) return text;
    matches.sort((a, b) => a.start - b.start);

    let result = '';
    let lastIdx = 0;
    for (const match of matches) {
        result += text.slice(lastIdx, match.start);
        if (match.type === 'url') {
            result += `<a class="snapshot-url-link" href="${match.value}" target="_blank" rel="noopener">${match.value}</a>`;
        } else {
            const dataLine = match.line ? ` data-line="${match.line}"` : '';
            result += `<span class="snapshot-file-link" data-path="${match.value}"${dataLine}>${text.slice(match.start, match.end)}</span>`;
        }
        lastIdx = match.end;
    }
    result += text.slice(lastIdx);
    return result;
}
