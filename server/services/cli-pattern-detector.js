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

const CODEX_PROMPT_PATTERNS = [
    /^›\s*$/,               // Codex empty prompt
    /^›\s/,                 // Codex prompt with draft text
];

const CLAUDE_SPINNER_PATTERNS = [
    /^[✻✼✽✾⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/,  // Unicode spinners
    /Thinking\.\.\./i,
];

const WAITING_PATTERNS = [
    { pattern: /\(y\/n\)\s*:?\s*$/i, reason: 'yes_no_prompt' },
    { pattern: /\[Y\/n\]\s*$/i, reason: 'yes_no_prompt' },
    { pattern: /\[y\/N\]\s*$/i, reason: 'yes_no_prompt' },
    { pattern: /\(yes\/no\)\s*:?\s*$/i, reason: 'yes_no_prompt' },
    { pattern: /Do you want to\s/i, reason: 'confirmation_prompt' },
    { pattern: /Would you like to\s+proceed\?/i, reason: 'execution_approval_prompt' },
    { pattern: /Do you want to make this edit/i, reason: 'edit_approval_prompt' },
    { pattern: /Allow\s.*\?\s*$/i, reason: 'allow_prompt' },
    { pattern: /Enter to select/i, reason: 'choice_prompt' },
    { pattern: /Enter to confirm/i, reason: 'workspace_trust_prompt' },
    { pattern: /Esc to cancel\s*·\s*Tab to amend/i, reason: 'edit_approval_prompt' },
    { pattern: /Resume a previous session/i, reason: 'codex_resume_picker' },
    { pattern: /enter to resume/i, reason: 'codex_resume_picker' },
    { pattern: /enter to submit answer/i, reason: 'codex_plan_question' },
    { pattern: /Question\s+\d+\/\d+.*\bunanswered\b/i, reason: 'codex_plan_question' },
];

const SHELL_PROMPT_PATTERNS = [
    /^\$\s*$/,              // bash $ prompt
    /^%\s*$/,               // zsh % prompt
    /^\$\s/,                // $ with content
    /^%\s/,                 // % with content
    /^[\w.-]+@[\w.-]+\s+\S+\s+[%$]\s*$/, // user@host cwd %
];

const TAIL_LINES = 12;
const WAITING_TAIL_LINES = 40;

/**
 * ターミナル出力末尾からCLI状態を検出
 *
 * @param {string|null} output - tmux capture-pane の出力
 * @returns {string} CliState value
 */
export function detectCliState(output) {
    return detectCliStateDetail(output).state;
}

export function detectCliStateDetail(output) {
    if (!output || typeof output !== 'string') {
        return { state: CliState.UNKNOWN, reason: 'empty' };
    }

    // ANSIエスケープシーケンスを除去してからパターン検出
    const cleaned = stripAnsi(output);

    // 末尾の空行を除去してから末尾行を取得
    const lines = cleaned.split('\n');
    const tailCandidateLines = [];
    let foundContent = false;
    for (let i = lines.length - 1; i >= 0 && tailCandidateLines.length < WAITING_TAIL_LINES; i--) {
        const line = lines[i];
        if (!foundContent && line.trim() === '') continue;
        foundContent = true;
        tailCandidateLines.unshift(line);
    }

    if (tailCandidateLines.length === 0) {
        return { state: CliState.UNKNOWN, reason: 'empty_tail' };
    }

    const trimmedLines = tailCandidateLines.slice(-TAIL_LINES);
    const lastLine = trimmedLines[trimmedLines.length - 1];
    const waitingTailText = tailCandidateLines.join('\n');

    // Priority 1: Waiting (confirmation prompt) - 最優先
    const waitingMatch = matchAny(waitingTailText, WAITING_PATTERNS);
    if (waitingMatch) {
        return { state: CliState.WAITING, reason: waitingMatch.reason };
    }

    // Priority 2: Thinking (spinner/processing)
    if (matchesAny(lastLine, CLAUDE_SPINNER_PATTERNS)) {
        return { state: CliState.THINKING, reason: 'spinner' };
    }

    // Priority 3: Ready (CLI prompt)
    // Claude/Codex draw a status bar below the prompt, so the prompt is often
    // not the final line captured by tmux. Scan the trimmed tail lines.
    if (trimmedLines.some(line => matchesAny(line, CLAUDE_PROMPT_PATTERNS))) {
        return { state: CliState.READY, reason: 'claude_prompt' };
    }
    if (trimmedLines.some(line => matchesAny(line, CODEX_PROMPT_PATTERNS))) {
        return { state: CliState.READY, reason: 'codex_prompt' };
    }

    // Priority 4: Idle (shell prompt)
    if (trimmedLines.some(line => matchesAny(line, SHELL_PROMPT_PATTERNS))) {
        return { state: CliState.IDLE, reason: 'shell_prompt' };
    }

    return { state: CliState.UNKNOWN, reason: 'none' };
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
    const textResult = detectCliStateDetail(plainText);
    const textState = textResult.state;

    if (!colorText || typeof colorText !== 'string') {
        if (textState === CliState.UNKNOWN) {
            return { state: CliState.UNKNOWN, confidence: 0, source: 'none', reason: textResult.reason };
        }
        return { state: textState, confidence: 0.5, source: 'text', reason: textResult.reason };
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
            return { state: CliState.UNKNOWN, confidence: 0, source: 'none', reason: textResult.reason };
        }
        return { state: textState, confidence: 0.5, source: 'text', reason: textResult.reason };
    }

    // Confirmation/choice UIs often use the same colors as normal prompt rows.
    // If the text clearly says it is waiting for a choice, do not let ANSI color
    // heuristics downgrade it to READY.
    if (textState === CliState.WAITING && colorState !== CliState.WAITING) {
        return { state: CliState.WAITING, confidence: 0.95, source: 'text', reason: textResult.reason };
    }

    // 色とテキストが一致 → 高confidence
    if (textState !== CliState.UNKNOWN && textState === colorState) {
        return { state: colorState, confidence: 0.95, source: 'color', reason: textResult.reason };
    }

    return { state: colorState, confidence: 0.7, source: 'color', reason: `ansi_color_${colorState}` };
}

function matchesAny(text, patterns) {
    return patterns.some(pattern => pattern.test(text));
}

function matchAny(text, entries) {
    return entries.find(entry => entry.pattern.test(text)) || null;
}
