/**
 * 軽量 ANSI→HTML コンバータ
 *
 * ターミナルスナップショットのfallback表示用。
 * xterm.jsが使えない場面（snapshot panel等）でANSI色付きテキストを
 * HTMLに変換して色表示する。
 *
 * XSS安全: HTMLエスケープを先に行ってからspan生成。
 */

const BASIC_COLORS = [
    '#000000', // 30 black
    '#cd0000', // 31 red
    '#00cd00', // 32 green
    '#cdcd00', // 33 yellow
    '#0000ee', // 34 blue
    '#cd00cd', // 35 magenta
    '#00cdcd', // 36 cyan
    '#e5e5e5', // 37 white
];

const BRIGHT_COLORS = [
    '#7f7f7f', // 90 bright black
    '#ff0000', // 91 bright red
    '#00ff00', // 92 bright green
    '#ffff00', // 93 bright yellow
    '#5c5cff', // 94 bright blue
    '#ff00ff', // 95 bright magenta
    '#00ffff', // 96 bright cyan
    '#ffffff', // 97 bright white
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
    if (state.color) parts.push(`color:${state.color}`);
    if (state.bold) parts.push('font-weight:bold');
    if (state.dim) parts.push('opacity:0.7');
    return parts.join(';');
}

/**
 * ANSIエスケープシーケンス付きテキストをHTML変換
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function ansiToHtml(text) {
    if (!text || typeof text !== 'string') return '';

    // Step 1: HTMLエスケープ（XSS防止）
    const escaped = escapeHtml(text);

    // Step 2: ANSIシーケンスをHTMLに変換
    // エスケープ済みテキスト中のANSIシーケンスを処理
    // Note: \x1b はHTMLエスケープに影響されない制御文字
    const SGR_RE = /\x1b\[([\d;]*)m/g;
    const state = { color: null, bold: false, dim: false };
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
                state.bold = false;
                state.dim = false;
            } else if (p === 1) {
                state.bold = true;
            } else if (p === 2) {
                state.dim = true;
            } else if (p >= 30 && p <= 37) {
                state.color = BASIC_COLORS[p - 30];
            } else if (p >= 90 && p <= 97) {
                state.color = BRIGHT_COLORS[p - 90];
            } else if (p === 38 && params[i + 1] === 5 && params[i + 2] != null) {
                state.color = color256(params[i + 2]);
                i += 2; // skip ;5;N
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

    return result;
}
