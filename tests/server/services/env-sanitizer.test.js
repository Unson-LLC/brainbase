import { describe, it, expect } from 'vitest';
import { getEnvSanitizeCommands, SANITIZE_ENV_VARS } from '../../../server/services/env-sanitizer.js';

/**
 * 環境変数サニタイズテスト（CommandMate移植）
 * CLIネスト検出を防ぐための環境変数除去
 */
describe('env-sanitizer', () => {
    describe('SANITIZE_ENV_VARS', () => {
        it('CLAUDECODE環境変数が含まれている', () => {
            expect(SANITIZE_ENV_VARS).toContain('CLAUDECODE');
        });

        it('CLAUDE_CODE_ENTRYPOINTが含まれている', () => {
            expect(SANITIZE_ENV_VARS).toContain('CLAUDE_CODE_ENTRYPOINT');
        });

        it('npm_config_prefixが含まれている', () => {
            expect(SANITIZE_ENV_VARS).toContain('npm_config_prefix');
            expect(SANITIZE_ENV_VARS).toContain('NPM_CONFIG_PREFIX');
        });
    });

    describe('getEnvSanitizeCommands()', () => {
        it('tmux global unset コマンドを生成する', () => {
            const commands = getEnvSanitizeCommands('tmux-global');

            expect(commands).toBeInstanceOf(Array);
            expect(commands.length).toBeGreaterThan(0);

            // tmux set-environment -g -u 形式
            for (const cmd of commands) {
                expect(cmd).toMatch(/^tmux set-environment -g -u /);
            }
        });

        it('tmux session unset コマンドを生成する', () => {
            const commands = getEnvSanitizeCommands('tmux-session', 'my-session');

            expect(commands).toBeInstanceOf(Array);
            for (const cmd of commands) {
                expect(cmd).toMatch(/^tmux set-environment -t "my-session" -u /);
            }
        });

        it('shell unset コマンドを生成する', () => {
            const commands = getEnvSanitizeCommands('shell');

            expect(commands).toBeInstanceOf(Array);
            for (const cmd of commands) {
                expect(cmd).toMatch(/^unset /);
            }
        });

        it('CLAUDECODE用コマンドが含まれている', () => {
            const commands = getEnvSanitizeCommands('tmux-global');
            const claudeCodeCmd = commands.find(c => c.includes('CLAUDECODE'));
            expect(claudeCodeCmd).toBeDefined();
        });

        it('sessionId未指定でtmux-session_エラーを投げる', () => {
            expect(() => getEnvSanitizeCommands('tmux-session')).toThrow();
        });
    });
});
