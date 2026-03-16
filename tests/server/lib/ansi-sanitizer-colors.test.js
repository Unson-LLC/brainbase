import { describe, it, expect } from 'vitest';
import { extractAnsiColors } from '../../../server/lib/ansi-sanitizer.js';

describe('extractAnsiColors', () => {
    it('null/空文字の場合_空配列が返される', () => {
        expect(extractAnsiColors(null)).toEqual([]);
        expect(extractAnsiColors('')).toEqual([]);
        expect(extractAnsiColors(undefined)).toEqual([]);
    });

    it('256色エスケープシーケンスから色番号が抽出される', () => {
        // \x1b[38;5;114m = 256色のcolor 114 (緑)
        const input = '\x1b[38;5;114mHello world\x1b[0m';
        const result = extractAnsiColors(input);
        expect(result).toHaveLength(1);
        expect(result[0].colors).toContain(114);
        expect(result[0].text).toContain('Hello world');
    });

    it('複数行で行ごとに色情報が返される', () => {
        const input = [
            '\x1b[38;5;114mGreen line\x1b[0m',
            '\x1b[38;5;231mWhite line\x1b[0m',
            '\x1b[38;5;211mPink line\x1b[0m',
        ].join('\n');
        const result = extractAnsiColors(input);
        expect(result).toHaveLength(3);
        expect(result[0].colors).toContain(114);
        expect(result[1].colors).toContain(231);
        expect(result[2].colors).toContain(211);
    });

    it('bold/dimスタイル情報が抽出される', () => {
        // \x1b[1m = bold, \x1b[2m = dim
        const input = '\x1b[1m\x1b[38;5;114mBold green\x1b[0m';
        const result = extractAnsiColors(input);
        expect(result).toHaveLength(1);
        expect(result[0].bold).toBe(true);
        expect(result[0].colors).toContain(114);
    });

    it('ANSIシーケンスがない行では色なしが返される', () => {
        const input = 'plain text line';
        const result = extractAnsiColors(input);
        expect(result).toHaveLength(1);
        expect(result[0].colors).toEqual([]);
        expect(result[0].bold).toBe(false);
        expect(result[0].dim).toBe(false);
    });
});
