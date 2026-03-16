import { describe, it, expect } from 'vitest';
import { detectCliState, CliState } from '../../../server/services/cli-pattern-detector.js';

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

        it('bash/zshプロンプト（$）検出_IDLEを返す', () => {
            const output = `Last command output\n$ `;
            expect(detectCliState(output)).toBe(CliState.IDLE);
        });

        it('末尾5行のみ検査する', () => {
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

        it('通常のテキスト出力_UNKNOWNを返す', () => {
            const output = 'Just some regular text output\nwithout any prompt indicators';
            expect(detectCliState(output)).toBe(CliState.UNKNOWN);
        });
    });
});
