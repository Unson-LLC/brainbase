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

    // --- リンク検出テスト ---

    it('URLをクリック可能なリンクに変換する', () => {
        const result = ansiToHtml('see https://example.com/path for details');
        expect(result).toContain('<a class="snapshot-url-link"');
        expect(result).toContain('href="https://example.com/path"');
        expect(result).toContain('target="_blank"');
    });

    it('ファイルパスをクリック可能な要素に変換する', () => {
        const result = ansiToHtml('edit ./src/app.js:42');
        expect(result).toContain('<span class="snapshot-file-link"');
        expect(result).toContain('data-path="./src/app.js"');
        expect(result).toContain('data-line="42"');
    });

    it('ANSI色付きテキスト内のリンクも検出する', () => {
        const input = '\x1b[32mhttps://example.com\x1b[0m';
        const result = ansiToHtml(input);
        expect(result).toContain('<a class="snapshot-url-link"');
        expect(result).toContain('https://example.com');
    });

    it('ファイルパス（行番号なし）を検出する', () => {
        const result = ansiToHtml('modified server/routes/api.ts');
        expect(result).toContain('<span class="snapshot-file-link"');
        expect(result).toContain('data-path="server/routes/api.ts"');
        expect(result).not.toContain('data-line');
    });

    it('リンクでないテキストはそのまま', () => {
        const result = ansiToHtml('hello world 123');
        expect(result).toBe('hello world 123');
        expect(result).not.toContain('<a');
        expect(result).not.toContain('snapshot-file-link');
    });

    it('単語の一部が拡張子にマッチする誤検出を防ぐ', () => {
        const result = ansiToHtml('gmail.com user@example.c cursorvers.c');
        expect(result).not.toContain('snapshot-file-link');
    });

    it('スラッシュを含むパスは検出する', () => {
        const result = ansiToHtml('src/utils/helper.c');
        expect(result).toContain('snapshot-file-link');
        expect(result).toContain('data-path="src/utils/helper.c"');
    });

    // --- 非SGRシーケンス除去テスト ---

    it('カーソル移動シーケンスを除去する', () => {
        const input = 'line1\x1b[Aline2';
        const result = ansiToHtml(input);
        expect(result).toBe('line1line2');
        expect(result).not.toContain('\x1b');
    });

    it('画面クリア・行クリアシーケンスを除去する', () => {
        const input = '\x1b[2Jhello\x1b[K';
        const result = ansiToHtml(input);
        expect(result).toBe('hello');
    });

    it('OSCシーケンス（ウィンドウタイトル等）を除去する', () => {
        const input = '\x1b]0;my title\x07hello';
        const result = ansiToHtml(input);
        expect(result).toBe('hello');
    });

    it('SGR + 非SGRが混在する場合、色は保持して制御シーケンスのみ除去', () => {
        const input = '\x1b[32mgreen\x1b[A\x1b[Ktext\x1b[0m';
        const result = ansiToHtml(input);
        expect(result).toContain('green');
        expect(result).toContain('text');
        expect(result).not.toContain('\x1b[A');
        expect(result).not.toContain('\x1b[K');
    });

    it('カーソル表示/非表示シーケンスを除去する', () => {
        const input = '\x1b[?25lhello\x1b[?25h';
        const result = ansiToHtml(input);
        expect(result).toBe('hello');
    });
});
