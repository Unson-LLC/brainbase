import { describe, it, expect } from 'vitest';
import { detectCliStateWithColors, CliState } from '../../../server/services/cli-pattern-detector.js';

describe('detectCliStateWithColors', () => {
    it('null入力の場合_UNKNOWNが返される', () => {
        const result = detectCliStateWithColors(null, null);
        expect(result.state).toBe(CliState.UNKNOWN);
        expect(result.source).toBe('none');
    });

    it('緑色(114)検出時_THINKINGが返される（ツール実行中）', () => {
        const plainText = 'Running tool...';
        const colorText = '\x1b[38;5;114mRunning tool...\x1b[0m';
        const result = detectCliStateWithColors(plainText, colorText);
        expect(result.state).toBe(CliState.THINKING);
        expect(result.source).toBe('color');
        expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('白色(231)検出時_THINKINGが返される（AI応答中）', () => {
        const plainText = 'Some AI output text here';
        const colorText = '\x1b[38;5;231mSome AI output text here\x1b[0m';
        const result = detectCliStateWithColors(plainText, colorText);
        expect(result.state).toBe(CliState.THINKING);
        expect(result.source).toBe('color');
    });

    it('ピンク色(211)検出時_WAITINGが返される（警告/確認）', () => {
        const plainText = 'Allow this action?';
        const colorText = '\x1b[38;5;211mAllow this action?\x1b[0m';
        const result = detectCliStateWithColors(plainText, colorText);
        expect(result.state).toBe(CliState.WAITING);
        expect(result.source).toBe('color');
    });

    it('薄灰色(246)検出時_READYが返される（プロンプト付近）', () => {
        const plainText = '> ';
        const colorText = '\x1b[38;5;246m> \x1b[0m';
        const result = detectCliStateWithColors(plainText, colorText);
        expect(result.state).toBe(CliState.READY);
        expect(result.source).toBe('color');
    });

    it('色情報がない場合_テキストフォールバックが使用される', () => {
        const plainText = '❯ ';
        const colorText = null;
        const result = detectCliStateWithColors(plainText, colorText);
        expect(result.state).toBe(CliState.READY);
        expect(result.source).toBe('text');
    });

    it('色情報とテキストの両方が一致する場合_confidenceが高くなる', () => {
        const plainText = '❯ ';
        const colorText = '\x1b[38;5;246m❯ \x1b[0m';
        const result = detectCliStateWithColors(plainText, colorText);
        expect(result.state).toBe(CliState.READY);
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });
});
