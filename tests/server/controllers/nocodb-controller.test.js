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

    it('getFallbackIdFields呼び出し時_数値IDならIdとIDの候補を返す', () => {
        const controller = new NocoDBController({ getNocoDBMappings: async () => [] });

        expect(controller._getFallbackIdFields('CustomId', 12)).toEqual(['Id', 'ID']);
    });

    it('getFallbackIdFields呼び出し時_既にIdならIDだけを返す', () => {
        const controller = new NocoDBController({ getNocoDBMappings: async () => [] });

        expect(controller._getFallbackIdFields('Id', 12)).toEqual(['ID']);
    });

    it('getFallbackIdFields呼び出し時_文字列IDは空配列になる', () => {
        const controller = new NocoDBController({ getNocoDBMappings: async () => [] });

        expect(controller._getFallbackIdFields('CustomId', 'TASK-1')).toEqual([]);
    });

    it('resolveIdFieldName呼び出し時_pkカラムが優先される', () => {
        const controller = new NocoDBController({ getNocoDBMappings: async () => [] });
        const tableDetail = {
            columns: [
                { title: 'CustomId', pk: true },
                { title: 'ID', uidt: 'ID' }
            ]
        };

        expect(controller._resolveIdFieldName(tableDetail)).toBe('CustomId');
    });

    it('resolveIdFieldName呼び出し時_ID型カラムが使用される', () => {
        const controller = new NocoDBController({ getNocoDBMappings: async () => [] });
        const tableDetail = {
            columns: [
                { title: 'RowId', uidt: 'ID' }
            ]
        };

        expect(controller._resolveIdFieldName(tableDetail)).toBe('RowId');
    });

    it('resolveIdFieldName呼び出し時_デフォルトはIdを返す', () => {
        const controller = new NocoDBController({ getNocoDBMappings: async () => [] });

        expect(controller._resolveIdFieldName(null)).toBe('Id');
    });

    it('selectRecordId呼び出し時_Idを優先する', () => {
        const controller = new NocoDBController({ getNocoDBMappings: async () => [] });
        const record = { Id: 12, ID: 'TASK-12' };

        expect(controller._selectRecordId(record, 0)).toBe(12);
    });
});
