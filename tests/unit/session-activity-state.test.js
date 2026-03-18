import { describe, it, expect } from 'vitest';
import { deriveActivityState, ActivityState } from '../../public/modules/core/session-activity-state.js';

/**
 * セッションアクティビティ状態の細分化テスト
 * CommandMateの5段階ステータスパターン移植
 */
describe('session-activity-state', () => {
    describe('ActivityState定数', () => {
        it('全ステータスが定義されている', () => {
            expect(ActivityState.IDLE).toBe('idle');
            expect(ActivityState.WORKING).toBe('working');
            expect(ActivityState.THINKING).toBe('thinking');
            expect(ActivityState.GOALSEEK).toBe('goalseek');
            expect(ActivityState.DONE_UNREAD).toBe('done-unread');
            expect(ActivityState.STALE).toBe('stale');
        });
    });

    describe('deriveActivityState()', () => {
        it('hookStatusなし_IDLEを返す', () => {
            expect(deriveActivityState(null)).toBe(ActivityState.IDLE);
            expect(deriveActivityState(undefined)).toBe(ActivityState.IDLE);
        });

        it('isWorking=true, activeTurnCount>0_THINKINGを返す', () => {
            const hookStatus = {
                isWorking: true,
                isDone: false,
                activeTurnCount: 1,
                goalSeek: { active: false }
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.THINKING);
        });

        it('isWorking=true, activeTurnCount=0_WORKINGを返す', () => {
            const hookStatus = {
                isWorking: true,
                isDone: false,
                activeTurnCount: 0,
                goalSeek: { active: false }
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.WORKING);
        });

        it('isWorking=true, goalSeek.active=true_GOALSEEKを返す', () => {
            const hookStatus = {
                isWorking: true,
                isDone: false,
                activeTurnCount: 1,
                goalSeek: { active: true, iteration: 2, maxIterations: 5 }
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.GOALSEEK);
        });

        it('goalSeek.active=true but not working_GOALSEEKを返す', () => {
            const hookStatus = {
                isWorking: false,
                isDone: false,
                activeTurnCount: 0,
                goalSeek: { active: true, iteration: 1, maxIterations: 3 }
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.GOALSEEK);
        });

        it('isDone=true_DONE_UNREADを返す', () => {
            const hookStatus = {
                isWorking: false,
                isDone: true,
                activeTurnCount: 0,
                goalSeek: { active: false }
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.DONE_UNREAD);
        });

        it('isWorking=false, isDone=false_IDLEを返す', () => {
            const hookStatus = {
                isWorking: false,
                isDone: false,
                activeTurnCount: 0,
                goalSeek: { active: false }
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.IDLE);
        });

        it('goalSeekがnull/undefined_安全にフォールバックする', () => {
            const hookStatus = {
                isWorking: true,
                isDone: false,
                activeTurnCount: 0,
                goalSeek: null
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.WORKING);

            const hookStatus2 = {
                isWorking: true,
                isDone: false,
                activeTurnCount: 0
                // goalSeek is undefined
            };
            expect(deriveActivityState(hookStatus2)).toBe(ActivityState.WORKING);
        });

        it('activeTurnCountがundefined_0として扱う', () => {
            const hookStatus = {
                isWorking: true,
                isDone: false,
                goalSeek: { active: false }
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.WORKING);
        });
    });
});
