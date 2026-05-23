// @ts-check
import { DEFAULT_TERMINAL_THEME, buildTerminalAnsiPalette } from '../terminal/terminal-theme.js';

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
function color256(n, palette) {
    if (n < 16) return palette[n];
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
function resolveForegroundColor(state, palette) {
    if (state.colorIndex == null) return state.color;
    if (state.bold && state.colorIndex >= 0 && state.colorIndex < 8) {
        return palette[state.colorIndex + 8];
    }
    return palette[state.colorIndex];
}

function resolveBackgroundColor(state, palette) {
    if (state.bgColorIndex == null) return state.bgColor;
    return palette[state.bgColorIndex];
}

function buildStyle(state, palette) {
    const parts = [];
    const resolvedFg = resolveForegroundColor(state, palette);
    const resolvedBg = resolveBackgroundColor(state, palette);
    const fg = state.reverse ? (resolvedBg || null) : resolvedFg;
    const bg = state.reverse ? (resolvedFg || null) : resolvedBg;
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
 * @param {{ theme?: Record<string, string>, lineScoped?: boolean }} [options]
 * @returns {string}
 */
export function ansiToHtml(text, options = {}) {
    if (!text || typeof text !== 'string') return '';
    const palette = buildTerminalAnsiPalette(options.theme || DEFAULT_TERMINAL_THEME);
    const lineScoped = options.lineScoped !== false;

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
    const state = {
        color: null,
        colorIndex: null,
        bgColor: null,
        bgColorIndex: null,
        bold: false,
        dim: false,
        italic: false,
        underline: false,
        strikethrough: false,
        reverse: false
    };
    let result = '';
    let lastIndex = 0;
    let spanOpen = false;
    let lineStyleSuppressed = false;
    let match;

    const closeSpan = () => {
        if (!spanOpen) return;
        result += '</span>';
        spanOpen = false;
    };

    const openCurrentSpan = () => {
        if (spanOpen || lineStyleSuppressed) return;
        const style = buildStyle(state, palette);
        if (!style) return;
        result += `<span style="${style}">`;
        spanOpen = true;
    };

    const appendTextSegment = (segment) => {
        if (!segment) return;
        if (!lineScoped || !segment.includes('\n')) {
            openCurrentSpan();
            result += segment;
            return;
        }

        const lines = segment.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i]) {
                openCurrentSpan();
                result += lines[i];
            }
            if (i < lines.length - 1) {
                closeSpan();
                result += '\n';
                lineStyleSuppressed = true;
            }
        }
    };

    while ((match = SGR_RE.exec(escaped)) !== null) {
        // マッチ前のテキストを追加
        appendTextSegment(escaped.slice(lastIndex, match.index));
        lastIndex = match.index + match[0].length;

        const params = match[1] ? match[1].split(';').map(Number) : [0];
        lineStyleSuppressed = false;

        let i = 0;
        while (i < params.length) {
            const p = params[i];
            if (p === 0) {
                // reset
                closeSpan();
                state.color = null;
                state.colorIndex = null;
                state.bgColor = null;
                state.bgColorIndex = null;
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
                state.color = null;
                state.colorIndex = p - 30;
            } else if (p === 39) {
                state.color = null;
                state.colorIndex = null;
            } else if (p >= 40 && p <= 47) {
                state.bgColor = null;
                state.bgColorIndex = p - 40;
            } else if (p === 49) {
                state.bgColor = null;
                state.bgColorIndex = null;
            } else if (p >= 90 && p <= 97) {
                state.color = null;
                state.colorIndex = p - 90 + 8;
            } else if (p >= 100 && p <= 107) {
                state.bgColor = null;
                state.bgColorIndex = p - 100 + 8;
            } else if (p === 38 && params[i + 1] === 5 && params[i + 2] != null) {
                state.color = color256(params[i + 2], palette);
                state.colorIndex = null;
                i += 2;
            } else if (p === 48 && params[i + 1] === 5 && params[i + 2] != null) {
                state.bgColor = color256(params[i + 2], palette);
                state.bgColorIndex = null;
                i += 2;
            } else if (p === 38 && params[i + 1] === 2 && params[i + 4] != null) {
                state.color = `#${params[i + 2].toString(16).padStart(2, '0')}${params[i + 3].toString(16).padStart(2, '0')}${params[i + 4].toString(16).padStart(2, '0')}`;
                state.colorIndex = null;
                i += 4;
            } else if (p === 48 && params[i + 1] === 2 && params[i + 4] != null) {
                state.bgColor = `#${params[i + 2].toString(16).padStart(2, '0')}${params[i + 3].toString(16).padStart(2, '0')}${params[i + 4].toString(16).padStart(2, '0')}`;
                state.bgColorIndex = null;
                i += 4;
            }
            i++;
        }

        // 現在のスタイルに応じてspanを開く
        const style = buildStyle(state, palette);
        if (style) {
            closeSpan();
            result += `<span style="${style}">`;
            spanOpen = true;
        }
    }

    // 残りのテキスト
    appendTextSegment(escaped.slice(lastIndex));
    closeSpan();

    return linkifyHtml(result);
}

// --- リンク検出（URL・ファイルパス） ---

const URL_RE = /https?:\/\/[^\s<>&"']+/g;

const FILE_EXTS = 'markdown|mdx|tsx|jsx|json|yaml|yml|toml|html|css|txt|svg|png|jpg|jpeg|gif|webp|ico|avif|bmp|xml|ini|cfg|env|sql|bash|md|mjs|cjs|js|ts|py|rb|go|rs|java|kt|swift|php|cpp|hpp|cc|sh|zsh|c|h|log';
const FILE_PATH_START_CHARS = '[\\p{L}\\p{N}_]';
const FILE_PATH_SEGMENT_CHARS = '[\\p{L}\\p{N}\\p{M}_/.\\-]';
const FILE_PATH_PREFIX = '(?:file:\\/\\/\\/|~\\/|\\.{1,2}\\/|\\/|\\.)';
const WRAPPED_FILE_PATH_RE = new RegExp(
    `(${FILE_PATH_PREFIX}${FILE_PATH_START_CHARS}${FILE_PATH_SEGMENT_CHARS}*(?:\\n\\s*${FILE_PATH_SEGMENT_CHARS}+)+\\.(?:${FILE_EXTS}))(?::([0-9]+))?`,
    'gu'
);
// パスに / を含むことを必須にして誤検出を防ぐ（gmail.c 等）
const FILE_PATH_RE = new RegExp(
    `(${FILE_PATH_PREFIX}${FILE_PATH_START_CHARS}${FILE_PATH_SEGMENT_CHARS}*\\.(?:${FILE_EXTS})|${FILE_PATH_START_CHARS}[\\p{L}\\p{N}\\p{M}_\\-]*\\/${FILE_PATH_SEGMENT_CHARS}*\\.(?:${FILE_EXTS}))(?::([0-9]+))?`,
    'gu'
);

function normalizeFileUriPath(filePath) {
    const raw = String(filePath || '').trim();
    if (!raw.startsWith('file:///')) return raw;
    try {
        return decodeURI(new URL(raw).pathname);
    } catch {
        return raw.replace(/^file:\/\//, '');
    }
}

function normalizeWrappedPath(filePath) {
    return normalizeFileUriPath(String(filePath || '').replace(/\n\s*/g, ''));
}

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

    WRAPPED_FILE_PATH_RE.lastIndex = 0;
    while ((m = WRAPPED_FILE_PATH_RE.exec(text)) !== null) {
        const originalPath = m[1];
        const filePath = normalizeWrappedPath(originalPath);
        const line = m[2] || '';
        const start = m.index;
        const end = m.index + m[0].length;
        if (matches.some(existing => start >= existing.start && start < existing.end)) continue;
        matches.push({ start, end, type: 'file', value: filePath, line });
    }

    FILE_PATH_RE.lastIndex = 0;
    while ((m = FILE_PATH_RE.exec(text)) !== null) {
        const filePath = normalizeFileUriPath(m[1]);
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
