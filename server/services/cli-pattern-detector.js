/**
 * CLI出力パターン検出（CommandMate移植）
 *
 * ターミナル出力の末尾からCLI（Claude Code, Codex等）の状態を推定する。
 * Hook報告が来ない場合のフォールバックとして使用。
 *
 * CommandMateのcli-patterns.ts / prompt-detector.tsを統合・簡略化。
 */
import { stripAnsi, extractAnsiColors } from '../lib/ansi-sanitizer.js';

/**
 * CLI状態の定数
 */
export const CliState = Object.freeze({
    /** シェルプロンプト表示中（CLI未起動） */
    IDLE: 'idle',
    /** CLIプロンプト表示中（入力待ち） */
    READY: 'ready',
    /** CLIが処理中（スピナー/thinking表示） */
    THINKING: 'thinking',
    /** CLIがユーザー確認待ち（yes/no等） */
    WAITING: 'waiting',
    /** 判定不能 */
    UNKNOWN: 'unknown',
});

// Claude CLI patterns
const CLAUDE_PROMPT_PATTERNS = [
    /^[❯>]\s*$/,           // ❯ or > at line start (empty prompt)
    /^[❯>]\s/,             // ❯ or > followed by space (with content)
];

const CLAUDE_SPINNER_PATTERNS = [
    /^[✻✼✽✾⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/,  // Unicode spinners
    /Thinking\.\.\./i,
];

const WAITING_PATTERNS = [
    /\(y\/n\)\s*:?\s*$/i,
    /\[Y\/n\]\s*$/i,
    /\[y\/N\]\s*$/i,
    /\(yes\/no\)\s*:?\s*$/i,
    /Do you want to\s/i,
    /Allow\s.*\?\s*$/i,
];

const SHELL_PROMPT_PATTERNS = [
    /^\$\s*$/,              // bash $ prompt
    /^%\s*$/,               // zsh % prompt
    /^\$\s/,                // $ with content
    /^%\s/,                 // % with content
];

const TAIL_LINES = 5;

/**
 * ターミナル出力末尾からCLI状態を検出
 *
 * @param {string|null} output - tmux capture-pane の出力
 * @returns {string} CliState value
 */
export function detectCliState(output) {
    if (!output || typeof output !== 'string') {
        return CliState.UNKNOWN;
    }

    // ANSIエスケープシーケンスを除去してからパターン検出
    const cleaned = stripAnsi(output);

    // 末尾の空行を除去してから末尾N行を取得
    const lines = cleaned.split('\n');
    const trimmedLines = [];
    let foundContent = false;
    for (let i = lines.length - 1; i >= 0 && trimmedLines.length < TAIL_LINES; i--) {
        const line = lines[i];
        if (!foundContent && line.trim() === '') continue;
        foundContent = true;
        trimmedLines.unshift(line);
    }

    if (trimmedLines.length === 0) {
        return CliState.UNKNOWN;
    }

    const lastLine = trimmedLines[trimmedLines.length - 1];
    const tailText = trimmedLines.join('\n');

    // Priority 1: Waiting (confirmation prompt) - 最優先
    if (matchesAny(tailText, WAITING_PATTERNS)) {
        return CliState.WAITING;
    }

    // Priority 2: Thinking (spinner/processing)
    if (matchesAny(lastLine, CLAUDE_SPINNER_PATTERNS)) {
        return CliState.THINKING;
    }

    // Priority 3: Ready (CLI prompt)
    if (matchesAny(lastLine, CLAUDE_PROMPT_PATTERNS)) {
        return CliState.READY;
    }

    // Priority 4: Idle (shell prompt)
    if (matchesAny(lastLine, SHELL_PROMPT_PATTERNS)) {
        return CliState.IDLE;
    }

    return CliState.UNKNOWN;
}

/**
 * ANSI 256色 → CLI状態マッピング
 */
const COLOR_STATE_MAP = {
    114: CliState.THINKING,  // 緑: ツール実行中
    231: CliState.THINKING,  // 白: AI応答中
    211: CliState.WAITING,   // ピンク: 警告/確認
    246: CliState.READY,     // 薄灰: ステータスバー（プロンプト付近）
};

/**
 * 色情報付きCLI状態検出
 * 色検出 → テキストフォールバック の2段階判定
 *
 * @param {string|null} plainText - サニタイズ済みテキスト（tmux capture-pane 通常出力）
 * @param {string|null} colorText - ANSI色付きテキスト（tmux capture-pane -e 出力）
 * @returns {{ state: string, confidence: number, source: string }}
 */
export function detectCliStateWithColors(plainText, colorText) {
    const textState = detectCliState(plainText);

    if (!colorText || typeof colorText !== 'string') {
        if (textState === CliState.UNKNOWN) {
            return { state: CliState.UNKNOWN, confidence: 0, source: 'none' };
        }
        return { state: textState, confidence: 0.5, source: 'text' };
    }

    // 色情報抽出（末尾数行を重視）
    const colorLines = extractAnsiColors(colorText);
    const tailColors = colorLines.slice(-TAIL_LINES);

    // 末尾行から色ベースで状態を判定（逆順で最後の行を優先）
    let colorState = null;
    for (let i = tailColors.length - 1; i >= 0; i--) {
        const line = tailColors[i];
        if (line.text.trim() === '') continue;
        for (const color of line.colors) {
            if (COLOR_STATE_MAP[color]) {
                colorState = COLOR_STATE_MAP[color];
                break;
            }
        }
        if (colorState) break;
    }

    if (!colorState) {
        if (textState === CliState.UNKNOWN) {
            return { state: CliState.UNKNOWN, confidence: 0, source: 'none' };
        }
        return { state: textState, confidence: 0.5, source: 'text' };
    }

    // 色とテキストが一致 → 高confidence
    if (textState !== CliState.UNKNOWN && textState === colorState) {
        return { state: colorState, confidence: 0.95, source: 'color' };
    }

    return { state: colorState, confidence: 0.7, source: 'color' };
}

function matchesAny(text, patterns) {
    return patterns.some(pattern => pattern.test(text));
}
