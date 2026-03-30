// @ts-check
/**
 * タスク概要（task brief）の導出ユーティリティ
 * session-controller.js と session-manager.js から共通化
 */

const TASK_BRIEF_MAX_LENGTH = 56;
const TASK_BRIEF_MIN_LENGTH = 8;
const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/;
const NATURAL_LANGUAGE_HINT_PATTERN = /\b(please|fix|make|update|improve|investigate|check|review|implement|show|change|add|remove|explain|summarize|help|need|want|should|could)\b/i;
const SHELL_COMMAND_PREFIXES = new Set([
    'git', 'jj', 'npm', 'pnpm', 'yarn', 'bun', 'node', 'npx', 'ls', 'cd', 'cat', 'sed', 'rg',
    'find', 'mkdir', 'rm', 'cp', 'mv', 'touch', 'bash', 'zsh', 'sh', 'python', 'python3', 'uv',
    'docker', 'tmux', 'claude', 'codex', 'curl'
]);

/**
 * @param {unknown} rawValue
 * @returns {string}
 */
export function normalizeTaskBriefCandidate(rawValue) {
    if (typeof rawValue !== 'string') return '';

    return rawValue
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .map((line) => line.replace(/^[-*•>\d.)\s]+/, '').trim())
        .filter(Boolean)
        .find((line) => {
            if (!line) return false;
            if (/[\x00-\x08\x0b-\x1f\x7f]/.test(line)) return false;
            if (/^\/[\w:-]+$/.test(line)) return false;
            if (/^https?:\/\//.test(line)) return false;
            if (/^(~|\.{1,2}|\/)?[\w./-]+$/.test(line)) return false;
            return true;
        }) || '';
}

/**
 * @param {string} candidate
 * @returns {boolean}
 */
export function looksLikeShellCommand(candidate) {
    if (!candidate || CJK_PATTERN.test(candidate)) return false;
    if (/[`$|&;<>]/.test(candidate)) return true;

    const tokens = candidate.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;

    const firstToken = tokens[0].toLowerCase();
    if (SHELL_COMMAND_PREFIXES.has(firstToken)) return true;

    const optionTokenCount = tokens.filter((token) => token.startsWith('-')).length;
    return optionTokenCount >= 2;
}

/**
 * @param {string} prompt
 * @returns {string | null}
 */
export function deriveTaskBriefFromPrompt(prompt) {
    const candidate = normalizeTaskBriefCandidate(prompt);
    if (!candidate || candidate.length < TASK_BRIEF_MIN_LENGTH) return null;

    const sentence = candidate.split(/(?<=[。.!?！？])\s+/)[0]?.trim() || candidate;
    const compact = sentence.replace(/\s+/g, ' ').trim();
    if (!compact || compact.length < TASK_BRIEF_MIN_LENGTH) return null;
    if (!CJK_PATTERN.test(compact) && !NATURAL_LANGUAGE_HINT_PATTERN.test(compact) && looksLikeShellCommand(compact)) {
        return null;
    }

    return compact.length > TASK_BRIEF_MAX_LENGTH
        ? `${compact.slice(0, TASK_BRIEF_MAX_LENGTH - 1)}…`
        : compact;
}

export { CJK_PATTERN, NATURAL_LANGUAGE_HINT_PATTERN, SHELL_COMMAND_PREFIXES, TASK_BRIEF_MAX_LENGTH, TASK_BRIEF_MIN_LENGTH };
