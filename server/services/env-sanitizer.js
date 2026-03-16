/**
 * 環境変数サニタイズ（CommandMate移植）
 *
 * tmuxセッション作成時にCLIネスト検出を引き起こす環境変数を除去。
 * CommandMateのEnvironment Sanitizationパターン:
 * - CLAUDECODE=1 → Claude Codeがネスト検出し起動拒否
 * - CLAUDE_CODE_ENTRYPOINT → Claude Codeの起動元検出
 * - npm_config_prefix → nvm互換性問題
 */

/**
 * サニタイズ対象の環境変数リスト
 */
export const SANITIZE_ENV_VARS = [
    // Claude Code ネスト検出防止
    'CLAUDECODE',
    'CLAUDE_CODE_ENTRYPOINT',

    // npm/nvm互換性
    'npm_config_prefix',
    'NPM_CONFIG_PREFIX',
];

/**
 * 指定モードのサニタイズコマンドを生成
 *
 * @param {'tmux-global' | 'tmux-session' | 'shell'} mode
 * @param {string} [sessionId] - tmux-session mode時に必要
 * @returns {string[]} 実行すべきコマンドの配列
 */
export function getEnvSanitizeCommands(mode, sessionId) {
    if (mode === 'tmux-session' && !sessionId) {
        throw new Error('sessionId is required for tmux-session mode');
    }

    return SANITIZE_ENV_VARS.map(varName => {
        switch (mode) {
            case 'tmux-global':
                return `tmux set-environment -g -u ${varName}`;
            case 'tmux-session':
                return `tmux set-environment -t "${sessionId}" -u ${varName}`;
            case 'shell':
                return `unset ${varName}`;
            default:
                throw new Error(`Unknown mode: ${mode}`);
        }
    });
}
