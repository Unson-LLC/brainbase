import { describe, expect, it } from 'vitest';
import { ansiToHtml } from '../../../../public/modules/utils/ansi-to-html.js';

describe('ansiToHtml', () => {
    it('プレーンテキストをそのまま返す', () => {
        expect(ansiToHtml('hello world')).toBe('hello world');
    });

    it('HTML特殊文字をエスケープする（XSS防止）', () => {
        expect(ansiToHtml('<script>alert("xss")</script>')).toBe(
            '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        );
    });

    it('基本色（30-37）をspan変換する', () => {
        const input = '\x1b[32mgreen text\x1b[0m';
        const result = ansiToHtml(input);
        expect(result).toContain('<span style="color:#00cd00">green text</span>');
    });

    it('明るい色（90-97）をspan変換する', () => {
        const input = '\x1b[91mbright red\x1b[0m';
        const result = ansiToHtml(input);
        expect(result).toContain('<span style="color:#ff0000">bright red</span>');
    });

    it('256色（38;5;N）をspan変換する', () => {
        const input = '\x1b[38;5;206mpink text\x1b[0m';
        const result = ansiToHtml(input);
        expect(result).toContain('pink text</span>');
        expect(result).toContain('<span style="color:');
    });

    it('bold（1）をfont-weight:boldに変換する', () => {
        const input = '\x1b[1mbold text\x1b[0m';
        const result = ansiToHtml(input);
        expect(result).toContain('font-weight:bold');
        expect(result).toContain('bold text');
    });

    it('dim（2）をopacity:0.7に変換する', () => {
        const input = '\x1b[2mdim text\x1b[0m';
        const result = ansiToHtml(input);
        expect(result).toContain('opacity:0.7');
        expect(result).toContain('dim text');
    });

    it('reset（0）でスタイルをリセットする', () => {
        const input = '\x1b[32mgreen\x1b[0m normal';
        const result = ansiToHtml(input);
        expect(result).toContain('green</span>');
        expect(result).toContain(' normal');
        // reset後のテキストはspanの外
        expect(result).toMatch(/green<\/span>\s*normal/);
    });

    it('未知のシーケンスを除去する', () => {
        const input = '\x1b[99mweird\x1b[0m';
        const result = ansiToHtml(input);
        expect(result).toContain('weird');
        // シーケンス文字列がそのまま残らない
        expect(result).not.toContain('\x1b');
    });

    it('null/undefinedは空文字を返す', () => {
        expect(ansiToHtml(null)).toBe('');
        expect(ansiToHtml(undefined)).toBe('');
        expect(ansiToHtml('')).toBe('');
    });

    it('複数色の組み合わせを正しく処理する', () => {
        const input = '\x1b[31mred\x1b[0m \x1b[34mblue\x1b[0m';
        const result = ansiToHtml(input);
        expect(result).toContain('red</span>');
        expect(result).toContain('blue</span>');
    });
});
