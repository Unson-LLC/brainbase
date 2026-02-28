import { describe, expect, it } from 'vitest';
import { calcKeyboardOffset, findWordBoundaryLeft, findWordBoundaryRight, pushHistory } from '../../public/modules/ui/mobile-input-utils.js';

describe('mobile-input-utils', () => {
    it('pushHistory呼び出し時_重複を除外して先頭に追加される', () => {
        const history = ['alpha', 'beta', 'gamma'];
        const next = pushHistory(history, 'beta', 10);
        expect(next).toEqual(['beta', 'alpha', 'gamma']);
    });

    it('pushHistory呼び出し時_空文字は無視される', () => {
        const history = ['alpha'];
        const next = pushHistory(history, '   ', 10);
        expect(next).toEqual(['alpha']);
    });

    it('pushHistory呼び出し時_上限を超えた場合は切り詰める', () => {
        const history = ['a', 'b', 'c'];
        const next = pushHistory(history, 'd', 2);
        expect(next).toEqual(['d', 'a']);
    });

    it('findWordBoundaryLeft呼び出し時_単語境界まで戻る', () => {
        const text = 'hello world';
        expect(findWordBoundaryLeft(text, 11)).toBe(6);
        expect(findWordBoundaryLeft(text, 6)).toBe(0);
    });

    it('findWordBoundaryRight呼び出し時_単語境界まで進む', () => {
        const text = 'hello world';
        expect(findWordBoundaryRight(text, 0)).toBe(5);
        expect(findWordBoundaryRight(text, 5)).toBe(11);
    });

    it('calcKeyboardOffset呼び出し時_キーボードなしは0になる', () => {
        expect(calcKeyboardOffset(900, 900, 0)).toBe(0);
    });

    it('calcKeyboardOffset呼び出し時_キーボード分の高さを返す', () => {
        expect(calcKeyboardOffset(900, 600, 0)).toBe(300);
        expect(calcKeyboardOffset(900, 600, 40)).toBe(300);
    });
});
