import { describe, it, expect } from 'vitest';
import { NocoDBController } from '../../../server/controllers/nocodb-controller.js';

describe('NocoDBController', () => {
    it('normalizeRecordId呼び出し時_数値文字列を数値に変換する', () => {
        const controller = new NocoDBController({ getNocoDBMappings: async () => [] });

        expect(controller._normalizeRecordId('123')).toBe(123);
    });

    it('normalizeRecordId呼び出し時_非数値IDはそのまま返す', () => {
        const controller = new NocoDBController({ getNocoDBMappings: async () => [] });

        expect(controller._normalizeRecordId('TASK-001')).toBe('TASK-001');
    });
});
