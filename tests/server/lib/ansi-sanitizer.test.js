import { describe, it, expect } from 'vitest';
import { stripAnsi, stripBoxDrawing, sanitizeTerminalOutput } from '../../../server/lib/ansi-sanitizer.js';

/**
 * ANSI/制御文字サニタイズテスト（CommandMate移植）
 * ターミナル出力からANSIエスケープコード・ボックス描画文字を除去
 */
describe('ansi-sanitizer', () => {
    describe('stripAnsi()', () => {
        it('色コードを除去する', () => {
            expect(stripAnsi('\x1b[31mred text\x1b[0m')).toBe('red text');
        });

        it('太字・下線を除去する', () => {
            expect(stripAnsi('\x1b[1mbold\x1b[0m \x1b[4munderline\x1b[0m')).toBe('bold underline');
        });

        it('カーソル移動を除去する', () => {
            expect(stripAnsi('\x1b[2J\x1b[Hclear screen')).toBe('clear screen');
        });

        it('256色・truecolorを除去する', () => {
            expect(stripAnsi('\x1b[38;5;196mred\x1b[0m')).toBe('red');
            expect(stripAnsi('\x1b[38;2;255;0;0mtrue red\x1b[0m')).toBe('true red');
        });

        it('ANSIなしテキストはそのまま返す', () => {
            expect(stripAnsi('normal text')).toBe('normal text');
        });

        it('空文字列・null_空文字列を返す', () => {
            expect(stripAnsi('')).toBe('');
            expect(stripAnsi(null)).toBe('');
        });

        it('OSCシーケンスを除去する', () => {
            // Window title set: ESC ] 0 ; title BEL
            expect(stripAnsi('\x1b]0;window title\x07rest')).toBe('rest');
        });
    });

    describe('stripBoxDrawing()', () => {
        it('ボックス描画文字を除去する', () => {
            expect(stripBoxDrawing('┌──────┐')).toBe('');
            expect(stripBoxDrawing('│ text │')).toBe(' text ');
            expect(stripBoxDrawing('└──────┘')).toBe('');
        });

        it('通常テキストはそのまま', () => {
            expect(stripBoxDrawing('normal text')).toBe('normal text');
        });
    });

    describe('sanitizeTerminalOutput()', () => {
        it('ANSI + ボックス描画を同時に除去する', () => {
            const input = '\x1b[1m┌─ \x1b[32mTitle\x1b[0m ─┐\nContent here';
            const result = sanitizeTerminalOutput(input);

            expect(result).not.toContain('\x1b');
            expect(result).not.toContain('┌');
            expect(result).not.toContain('─');
            expect(result).toContain('Title');
            expect(result).toContain('Content here');
        });

        it('連続空白を正規化する', () => {
            const result = sanitizeTerminalOutput('hello   world');
            expect(result).toBe('hello world');
        });

        it('空行の連続を正規化する', () => {
            const result = sanitizeTerminalOutput('line1\n\n\n\nline2');
            expect(result).toBe('line1\n\nline2');
        });
    });
});
