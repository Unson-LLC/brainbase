/**
 * Protected branch push guard.
 *
 * Detects shell commands that bypass PR review by directly pushing or
 * force-moving protected branches (develop / main / master). Used by:
 *  - Claude Code PreToolUse hook (forbidden-commands.ts)
 *  - Codex PreToolUse hook (codex-hooks-pre-tool-use-protected-push.sh)
 *
 * Root cause this guard addresses: 14e7c58d incident on 2026-05-11 where
 * a Codex session executed `git branch -f develop <ref> && git push origin
 * develop` from the main brainbase repo, silently dropping html-preview
 * routes during rebase conflict resolution.
 */

export const PROTECTED_BRANCHES = ['develop', 'main', 'master'];

const OVERRIDE_ENV = 'BRAINBASE_ALLOW_PROTECTED_PUSH=1';

const protectedAlt = PROTECTED_BRANCHES.join('|');

const PATTERNS = [
    {
        // `git push ... <protected>` where the last token is a protected branch name
        regex: new RegExp(`\\bgit\\s+push\\b[^&|;]*?(?:^|\\s)(?:${protectedAlt})(?=[\\s"'$&|;]|$)`, 'm'),
        reason: '保護ブランチ (develop/main/master) への直 push は禁止です。PR を作成して merge してください。'
    },
    {
        // refspec form: `git push ... <anything>:<protected>` (includes HEAD:develop, feat/x:develop)
        regex: new RegExp(`\\bgit\\s+push\\b[^&|;]*?:(?:${protectedAlt})(?=[\\s"'$&|;]|$)`),
        reason: '保護ブランチへの refspec push (HEAD:develop / feat/x:main 等) は禁止です。'
    },
    {
        // force push variants (force pushes anywhere are risky; warn-only for non-protected handled below)
        regex: /\bgit\s+push\b[^&|;]*?(?:--force\b|--force-with-lease\b|--mirror\b|(?:^|\s)-[a-zA-Z]*f[a-zA-Z]*(?=\s|$))/,
        reason: 'force push 系 (--force / --force-with-lease / -f / --mirror) は禁止です。履歴書き換えは PR で行ってください。'
    },
    {
        // git branch -f/-D/-M with protected target
        regex: new RegExp(`\\bgit\\s+branch\\s+(?:-[a-zA-Z]*[fDM][a-zA-Z]*|--force|--delete)\\s+(?:${protectedAlt})\\b`),
        reason: '保護ブランチの force-update / delete (git branch -f develop / -D main 等) は禁止です。'
    }
];

/**
 * Check whether the given shell command is blocked by the protected-push guard.
 *
 * @param {string} command - The shell command as it would be executed
 * @returns {{blocked: boolean, reason?: string}}
 */
export function isProtectedPushBlocked(command) {
    if (typeof command !== 'string' || command.length === 0) {
        return { blocked: false };
    }

    if (command.includes(OVERRIDE_ENV)) {
        return { blocked: false };
    }

    for (const { regex, reason } of PATTERNS) {
        if (regex.test(command)) {
            return { blocked: true, reason };
        }
    }

    return { blocked: false };
}
