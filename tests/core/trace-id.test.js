import { describe, it, expect } from 'vitest';
import { createTraceId } from '../../public/modules/core/trace-id.js';

describe('createTraceId', () => {
    it('デフォルトプレフィックス（bb）でIDを生成', () => {
        const traceId = createTraceId();

        expect(traceId).toMatch(/^bb-[a-z0-9]+-[a-z0-9]+$/);
    });

    it('カスタムプレフィックスでIDを生成', () => {
        const traceId = createTraceId('custom');

        expect(traceId).toMatch(/^custom-[a-z0-9]+-[a-z0-9]+$/);
    });

    it('3つのパート（prefix-timestamp-random）で構成される', () => {
        const traceId = createTraceId();
        const parts = traceId.split('-');

        expect(parts).toHaveLength(3);
        expect(parts[0]).toBe('bb');
        expect(parts[1]).toBeTruthy(); // timestamp部分
        expect(parts[2]).toBeTruthy(); // random部分
    });

    it('複数回呼び出すとユニークなIDが生成される', () => {
        const ids = new Set();

        for (let i = 0; i < 100; i++) {
            ids.add(createTraceId());
        }

        // 100回呼び出して全てユニークなIDが生成されることを確認
        expect(ids.size).toBe(100);
    });

    it('タイムスタンプ部分が36進数の文字列である', () => {
        const traceId = createTraceId();
        const parts = traceId.split('-');
        const timestamp = parts[1];

        // 36進数の文字列は0-9とa-zのみで構成される
        expect(timestamp).toMatch(/^[0-9a-z]+$/);
    });

    it('ランダム部分が8文字である', () => {
        const traceId = createTraceId();
        const parts = traceId.split('-');
        const random = parts[2];

        expect(random).toHaveLength(8);
    });
});
