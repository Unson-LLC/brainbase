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
            expect(ActivityState.WAITING).toBe('waiting');
            expect(ActivityState.WORKING).toBe('working');
            expect(ActivityState.THINKING).toBe('thinking');
            expect(ActivityState.DONE_UNREAD).toBe('done-unread');
        });
    });

    describe('deriveActivityState()', () => {
        it('hookStatusなし_IDLEを返す', () => {
            expect(deriveActivityState(null)).toBe(ActivityState.IDLE);
            expect(deriveActivityState(undefined)).toBe(ActivityState.IDLE);
        });

        it('liveActivityがwaiting_input_WAITINGを返す', () => {
            const hookStatus = {
                isWorking: true,
                isDone: false,
                activeTurnCount: 0,
                liveActivity: {
                    activityKind: 'waiting_input',
                    statusTone: 'waiting'
                }
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.WAITING);
        });

        it('isWorking=true, activeTurnCount>0_THINKINGを返す', () => {
            const hookStatus = {
                isWorking: true,
                isDone: false,
                activeTurnCount: 1
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.THINKING);
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

        it('activeTurnCountがundefined_0として扱う', () => {
            const hookStatus = {
                isWorking: true,
                isDone: false
            };
            expect(deriveActivityState(hookStatus)).toBe(ActivityState.WORKING);
        });
    });
});
