import { describe, it, expect } from 'vitest';
import { detectCliState, detectCliStateDetail, detectCliStateWithColors, CliState } from '../../../server/services/cli-pattern-detector.js';

/**
 * CLI出力パターン検出テスト（CommandMate移植）
 * ターミナル出力の末尾からClaude CLIの状態を判定
 */
describe('cli-pattern-detector', () => {
    describe('CliState定数', () => {
        it('全ステータスが定義されている', () => {
            expect(CliState.IDLE).toBe('idle');
            expect(CliState.READY).toBe('ready');
            expect(CliState.THINKING).toBe('thinking');
            expect(CliState.WAITING).toBe('waiting');
            expect(CliState.UNKNOWN).toBe('unknown');
        });
    });

    describe('detectCliState()', () => {
        it('空文字列_UNKNOWNを返す', () => {
            expect(detectCliState('')).toBe(CliState.UNKNOWN);
            expect(detectCliState(null)).toBe(CliState.UNKNOWN);
            expect(detectCliState(undefined)).toBe(CliState.UNKNOWN);
        });

        it('Claudeプロンプト（❯）検出_READYを返す', () => {
            const output = `Some previous output\n\n❯ `;
            expect(detectCliState(output)).toBe(CliState.READY);
        });

        it('Claudeプロンプト（>）検出_READYを返す', () => {
            const output = `Some output\n> `;
            expect(detectCliState(output)).toBe(CliState.READY);
        });

        it('Claudeスピナー（✻）検出_THINKINGを返す', () => {
            const output = `User prompt here\n✻ Thinking...`;
            expect(detectCliState(output)).toBe(CliState.THINKING);
        });

        it('Claudeスピナー（✽）検出_THINKINGを返す', () => {
            const output = `Some output\n✽ Processing request`;
            expect(detectCliState(output)).toBe(CliState.THINKING);
        });

        it('Yes/No確認プロンプト検出_WAITINGを返す', () => {
            const output = `Do you want to proceed?\n(y/n): `;
            expect(detectCliState(output)).toBe(CliState.WAITING);
        });

        it('Yes/No確認プロンプト（Y/n）検出_WAITINGを返す', () => {
            const output = `Allow this action?\n[Y/n] `;
            expect(detectCliState(output)).toBe(CliState.WAITING);
        });

        it('Claude選択式プロンプト検出_WAITINGを返す', () => {
            const output = [
                '  4. Type something.',
                '────────────────────────',
                '  5. Chat about this',
                '  6. Skip interview and plan immediately',
                '',
                'Enter to select · Tab/Arrow keys to navigate · Esc to cancel'
            ].join('\n');
            expect(detectCliState(output)).toBe(CliState.WAITING);
        });

        it('Claude実行承認プロンプト検出_WAITINGを返す', () => {
            const output = [
                'Claude has written up a plan and is ready to execute. Would you like to',
                'proceed?',
                '',
                ' ❯ 1. Yes, and bypass permissions',
                '   2. Yes, manually approve edits',
                ' ctrl-g to edit in Vim'
            ].join('\n');
            expect(detectCliState(output)).toBe(CliState.WAITING);
        });

        it('Claude編集承認プロンプト検出_WAITINGを返す', () => {
            const output = [
                'Do you want to make this edit to SKILL.md?',
                ' ❯ 1. Yes',
                '   2. Yes, and allow Claude to edit its own settings for this session',
                '',
                ' Esc to cancel · Tab to amend'
            ].join('\n');
            expect(detectCliState(output)).toBe(CliState.WAITING);
        });

        it('Claudeワークスペース信頼プロンプト検出_WAITINGを返す', () => {
            const output = [
                'Security guide',
                '',
                ' ❯ 1. Yes, I trust this folder',
                '   2. No, exit',
                '',
                ' Enter to confirm · Esc to cancel'
            ].join('\n');
            expect(detectCliState(output)).toBe(CliState.WAITING);
        });

        it('Claudeステータスバー付きプロンプト検出_READYを返す', () => {
            const output = [
                '────────────────────────────────',
                '❯ ',
                '────────────────────────────────',
                '  [Sonnet 4.6] | 📁 session',
                '  ⏵⏵ bypass permissions on'
            ].join('\n');
            expect(detectCliState(output)).toBe(CliState.READY);
        });

        it('Codexプロンプト検出_READYを返す', () => {
            const output = [
                '⚠ MCP startup incomplete',
                '',
                '› Run /review on my current changes',
                '',
                '  ? for shortcuts'
            ].join('\n');
            expect(detectCliState(output)).toBe(CliState.READY);
        });

        it('Codex resume picker検出_WAITINGを返す', () => {
            const output = [
                'Resume a previous session  Sort: Updated',
                'Type to search',
                '  Created      Updated      Branch   Conversation',
                '> 22 days ago  20 days ago  develop  brainbaseのFrameとStory',
                '',
                'enter to resume     esc to start new     ctrl + c to quit     tab to toggle sort     ↑/↓ to browse'
            ].join('\n');
            expect(detectCliState(output)).toBe(CliState.WAITING);
            expect(detectCliStateDetail(output)).toEqual({
                state: CliState.WAITING,
                reason: 'codex_resume_picker'
            });
        });

        it('Codex Plan Mode質問UI検出_WAITINGを返す', () => {
            const output = [
                '  Question 1/2 (2 unanswered)',
                '  現行Brainbaseはplain ES modules + Expressなので、Next.js実装の入り方をどこに置くか決めたいです。',
                '',
                '  › 1. 別Next画面 (Recommended)  既存UIを壊さず、VibePro専用Next.js画面を追加して段階移行できます。',
                '    2. 既存UI内に統合            右ドロワーだけをNext.jsで埋め込むため、配線は複雑になります。',
                '    3. 全面移行                  Brainbase UI全体をNext.jsへ移す大きなリプレイスになります。',
                '    4. None of the above         Optionally, add details in notes (tab).',
                '',
                '  tab to add notes | enter to submit answer | ←/→ to navigate questions | esc to interrupt'
            ].join('\n');
            expect(detectCliState(output)).toBe(CliState.WAITING);
            expect(detectCliStateDetail(output)).toEqual({
                state: CliState.WAITING,
                reason: 'codex_plan_question'
            });
        });


        it('bash/zshプロンプト（$）検出_IDLEを返す', () => {
            const output = `Last command output\n$ `;
            expect(detectCliState(output)).toBe(CliState.IDLE);
        });

        it('user@host形式のzshプロンプト検出_IDLEを返す', () => {
            const output = `^C^C\nksato@Mac-mini session-1774528552825-techknight %`;
            expect(detectCliState(output)).toBe(CliState.IDLE);
        });

        it('古いスピナーより新しいプロンプトを優先する', () => {
            // スピナーが古い行にあっても、末尾にプロンプトがあればREADY
            const output = [
                '✻ Thinking...',
                'Some response line 1',
                'Some response line 2',
                'Some response line 3',
                '',
                '❯ '
            ].join('\n');
            expect(detectCliState(output)).toBe(CliState.READY);
        });

        it('Claudeプロンプト下にステータス行が多い場合_READYを返す', () => {
            const output = [
                '────────────────────────────────',
                '❯ ',
                '────────────────────────────────',
                '  [Sonnet 4.6] | 📁 session',
                '  Compact: [0%]',
                '  Session: [24%]',
                '  ⏵⏵ bypass permissions on',
                '',
                '',
                ''
            ].join('\n');
            expect(detectCliState(output)).toBe(CliState.READY);
        });

        it('通常のテキスト出力_UNKNOWNを返す', () => {
            const output = 'Just some regular text output\nwithout any prompt indicators';
            expect(detectCliState(output)).toBe(CliState.UNKNOWN);
        });
    });

    describe('detectCliStateWithColors()', () => {
        it('確認プロンプトは色推定よりテキスト判定を優先する', () => {
            const plainText = [
                'Security guide',
                ' ❯ 1. Yes, I trust this folder',
                '   2. No, exit',
                ' Enter to confirm · Esc to cancel'
            ].join('\n');
            const colorText = '\u001b[38;5;246m❯ 1. Yes, I trust this folder\u001b[0m';

            expect(detectCliStateWithColors(plainText, colorText)).toMatchObject({
                state: CliState.WAITING,
                source: 'text',
                reason: 'workspace_trust_prompt'
            });
        });

        it('Codexプロンプトのreasonを返す', () => {
            const output = [
                '⚠ MCP startup incomplete',
                '',
                '› Implement {feature}',
                '',
                '  gpt-5.4 medium'
            ].join('\n');

            expect(detectCliStateDetail(output)).toEqual({
                state: CliState.READY,
                reason: 'codex_prompt'
            });
        });
    });
});
