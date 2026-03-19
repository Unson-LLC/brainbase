/**
 * ANSI/制御文字サニタイズ（CommandMate移植）
 *
 * CommandMateのresponse-cleaner.tsパターンを移植。
 * ターミナル出力からANSIエスケープコード、ボックス描画文字、
 * スピナー残骸等を除去してクリーンなテキストを返す。
 *
 * 用途:
 * - CLI Pattern Detector の入力前処理
 * - ターミナルスナップショットのクリーニング
 * - ログ保存時のサニタイズ
 */

/**
 * ANSIエスケープシーケンス除去パターン
 * CSI (Control Sequence Introducer): ESC [ ... final_byte
 * OSC (Operating System Command): ESC ] ... BEL/ST
 * その他の制御シーケンス
 */
const ANSI_PATTERN = new RegExp([
    // CSI sequences: ESC [ (params) (intermediate) final_byte
    '\\x1b\\[[0-9;]*[A-Za-z]',
    // OSC sequences: ESC ] ... (BEL | ESC \\)
    '\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)',
    // Other ESC sequences: ESC (single char)
    '\\x1b[^\\[\\]][A-Za-z]',
    // Standalone control chars (BEL, etc.)
    '[\\x07]',
].join('|'), 'g');

/**
 * ボックス描画文字パターン (Unicode Box Drawing block U+2500-U+257F)
 */
const BOX_DRAWING_PATTERN = /[\u2500-\u257F]/g;

/**
 * ANSIエスケープシーケンスを除去
 * @param {string|null} text
 * @returns {string}
 */
export function stripAnsi(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(ANSI_PATTERN, '');
}

/**
 * ボックス描画文字を除去
 * @param {string|null} text
 * @returns {string}
 */
export function stripBoxDrawing(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(BOX_DRAWING_PATTERN, '');
}

/**
 * ターミナル出力を完全サニタイズ
 * ANSI除去 + ボックス描画除去 + 空白正規化
 * @param {string|null} text
 * @returns {string}
 */
/**
 * 256色パターン: \x1b[38;5;{n}m
 */
const COLOR_256_PATTERN = /\x1b\[38;5;(\d+)m/g;

/**
 * Bold/Dimスタイルパターン
 */
const BOLD_PATTERN = /\x1b\[1m/;
const DIM_PATTERN = /\x1b\[2m/;

/**
 * ANSI色情報を行ごとに抽出
 * @param {string|null} text - ANSIエスケープシーケンスを含むテキスト
 * @returns {Array<{text: string, colors: number[], bold: boolean, dim: boolean}>}
 */
export function extractAnsiColors(text) {
    if (!text || typeof text !== 'string') return [];

    const lines = text.split('\n');
    return lines.map(line => {
        const colors = [];
        let match;
        const regex = new RegExp(COLOR_256_PATTERN.source, 'g');
        while ((match = regex.exec(line)) !== null) {
            colors.push(Number(match[1]));
        }
        return {
            text: stripAnsi(line),
            colors,
            bold: BOLD_PATTERN.test(line),
            dim: DIM_PATTERN.test(line),
        };
    });
}

export function sanitizeTerminalOutput(text) {
    if (!text || typeof text !== 'string') return '';

    let result = stripAnsi(text);
    result = stripBoxDrawing(result);

    // 連続空白を1つに正規化（行内のみ、改行は保持）
    result = result.replace(/[^\S\n]+/g, ' ');

    // 3行以上の空行を2行に正規化
    result = result.replace(/\n{3,}/g, '\n\n');

    return result.trim();
}
