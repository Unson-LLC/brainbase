import { describe, it, expect, beforeEach, vi } from 'vitest';

// StateControllerのモック（最小限）
class MockStateController {
    constructor() {
        this.sessionManager = {
            getActiveSessions: vi.fn(() => [])
        };
    }

    /**
     * include_archivedクエリパラメータに基づいてセッションをフィルタリング
     */
    filterSessionsByArchiveFlag(sessions, includeArchived) {
        if (includeArchived) {
            return sessions;
        }
        return sessions.filter(session => session.intendedState !== 'archived');
    }
}

describe('StateController', () => {
    let controller;

    beforeEach(() => {
        controller = new MockStateController();
    });

    describe('filterSessionsByArchiveFlag', () => {
        const allSessions = [
            { id: 'session-1', intendedState: 'active' },
            { id: 'session-2', intendedState: 'paused' },
            { id: 'session-3', intendedState: 'archived' },
            { id: 'session-4', intendedState: 'archived' }
        ];

        it('include_archived=trueの場合、全てのセッションを返す', () => {
            const result = controller.filterSessionsByArchiveFlag(allSessions, true);

            expect(result).toHaveLength(4);
            expect(result).toEqual(allSessions);
        });

        it('include_archived=falseの場合、アーカイブセッションを除外', () => {
            const result = controller.filterSessionsByArchiveFlag(allSessions, false);

            expect(result).toHaveLength(2);
            expect(result).toEqual([
                { id: 'session-1', intendedState: 'active' },
                { id: 'session-2', intendedState: 'paused' }
            ]);
        });

        it('アーカイブセッションのみの場合、空配列を返す', () => {
            const archivedOnly = [
                { id: 'session-3', intendedState: 'archived' },
                { id: 'session-4', intendedState: 'archived' }
            ];

            const result = controller.filterSessionsByArchiveFlag(archivedOnly, false);

            expect(result).toHaveLength(0);
            expect(result).toEqual([]);
        });

        it('空配列の場合、空配列を返す', () => {
            const result = controller.filterSessionsByArchiveFlag([], false);

            expect(result).toHaveLength(0);
            expect(result).toEqual([]);
        });

        it('include_archived=trueで空配列の場合も空配列を返す', () => {
            const result = controller.filterSessionsByArchiveFlag([], true);

            expect(result).toHaveLength(0);
            expect(result).toEqual([]);
        });
    });
});
