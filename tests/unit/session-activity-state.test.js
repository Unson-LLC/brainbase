import { describe, it, expect } from 'vitest';
import { deriveActivityState, ActivityState } from '../../public/modules/core/session-activity-state.js';

/**
 * セッションアクティビティ状態の細分化テスト
 */
describe('session-activity-state', () => {
    describe('ActivityState定数', () => {
        it('全ステータスが定義されている', () => {
            expect(ActivityState.IDLE).toBe('idle');
            expect(ActivityState.WORKING).toBe('working');
            expect(ActivityState.DONE_UNREAD).toBe('done-unread');
            expect(ActivityState.STALE).toBe('stale');
        });
    });

    describe('deriveActivityState()', () => {
        it('hookStatusなし_IDLEを返す', () => {
            expect(deriveActivityState(null)).toBe(ActivityState.IDLE);
            expect(deriveActivityState(undefined)).toBe(ActivityState.IDLE);
        });

        it('isWorking=true, activeTurnCount>0でも_WORKINGを返す', () => {
            const hookStatus = {
                isWorking: true,
                isDone: false,
                activeTurnCount: 1
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.WORKING);
        });

        it('isWorking=true, activeTurnCount=0_WORKINGを返す', () => {
            const hookStatus = {
                isWorking: true,
                isDone: false,
                activeTurnCount: 0
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.WORKING);
        });

        it('isDone=true_DONE_UNREADを返す', () => {
            const hookStatus = {
                isWorking: false,
                isDone: true,
                activeTurnCount: 0
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.DONE_UNREAD);
        });

        it('isWorking=false, isDone=false_IDLEを返す', () => {
            const hookStatus = {
                isWorking: false,
                isDone: false,
                activeTurnCount: 0
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.IDLE);
        });

        it('activeTurnCountがundefinedでも_WORKINGを返す', () => {
            const hookStatus = {
                isWorking: true,
                isDone: false
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.WORKING);
        });
    });
});
