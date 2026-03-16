import { describe, it, expect, afterEach } from 'vitest';
import { detectPastedTextOverlay, PASTED_TEXT_PATTERN } from '../../../server/services/pasted-text-detector.js';

/**
 * ペーストテキスト検出テスト（CommandMate移植）
 * マルチラインペースト時のターミナルオーバーレイを検出
 */
describe('pasted-text-detector', () => {
    describe('PASTED_TEXT_PATTERN', () => {
        it('標準的なペーストテキストオーバーレイにマッチする', () => {
            expect(PASTED_TEXT_PATTERN.test('[Pasted text #1 +46 lines]')).toBe(true);
        });

        it('別の番号と行数にもマッチする', () => {
            expect(PASTED_TEXT_PATTERN.test('[Pasted text #3 +120 lines]')).toBe(true);
        });

        it('通常テキストにはマッチしない', () => {
            expect(PASTED_TEXT_PATTERN.test('Some normal output')).toBe(false);
        });

        // reset lastIndex for global regex
        afterEach(() => {
            PASTED_TEXT_PATTERN.lastIndex = 0;
        });
    });

    describe('detectPastedTextOverlay()', () => {
        it('オーバーレイ含む出力_trueを返す', () => {
            const output = [
                'Some previous output',
                '❯ ',
                '[Pasted text #1 +46 lines]'
            ].join('\n');

            expect(detectPastedTextOverlay(output)).toBe(true);
        });

        it('オーバーレイなし出力_falseを返す', () => {
            const output = [
                'Normal output line 1',
                'Normal output line 2',
                '❯ '
            ].join('\n');

            expect(detectPastedTextOverlay(output)).toBe(false);
        });

        it('末尾10行のみ検査する', () => {
            const lines = [];
            for (let i = 0; i < 20; i++) {
                lines.push(`Line ${i}`);
            }
            // オーバーレイが先頭にある（末尾10行には含まれない）
            lines[0] = '[Pasted text #1 +10 lines]';

            expect(detectPastedTextOverlay(lines.join('\n'))).toBe(false);
        });

        it('空入力_falseを返す', () => {
            expect(detectPastedTextOverlay('')).toBe(false);
            expect(detectPastedTextOverlay(null)).toBe(false);
        });

        it('末尾10行以内にオーバーレイ_trueを返す', () => {
            const lines = [];
            for (let i = 0; i < 15; i++) {
                lines.push(`Line ${i}`);
            }
            // 末尾5行目にオーバーレイ
            lines[12] = '[Pasted text #2 +30 lines]';

            expect(detectPastedTextOverlay(lines.join('\n'))).toBe(true);
        });
    });
});
