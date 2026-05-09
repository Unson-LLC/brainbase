import { describe, expect, it } from 'vitest';
import {
    applyStateSchemaMigrations,
    createDefaultSessions,
    normalizeSessions,
    patchSessionInList,
    reorderSessionsList,
    upsertSessionInList
} from '../../lib/session-state-utils.js';

describe('session-state-utils', () => {
    it('legacy session schema を v3 永続化shapeへ正規化する', () => {
        const defaults = createDefaultSessions('/workspace/brainbase');
        const { state, changed } = applyStateSchemaMigrations({
            schemaVersion: 1,
            lastOpenTaskId: null,
            filters: {},
            readNotifications: [],
            focusSession: null,
            sessions: [
                {
                    id: 'brainbase',
                    archived: true,
                    ttydRunning: true,
                    runtimeStatus: { status: 'running' }
                }
            ]
        }, defaults);

        expect(changed).toBe(true);
        expect(state.schemaVersion).toBe(3);
        expect(state.sessions).toEqual([
            expect.objectContaining({
                id: 'brainbase',
                intendedState: 'archived',
                hookStatus: null,
                path: '/workspace/brainbase',
                ttydProcess: null
            })
        ]);
        expect(state.sessions[0]).not.toHaveProperty('archived');
        expect(state.sessions[0]).not.toHaveProperty('ttydRunning');
        expect(state.sessions[0]).not.toHaveProperty('runtimeStatus');
    });

    it('ephemeral path 更新時は既存の durable path を保持する', () => {
        const [session] = normalizeSessions([
            {
                id: 'session-1',
                path: '/private/tmp',
                worktree: { path: '/private/tmp' },
                lastKnownGoodPath: '/private/tmp'
            }
        ], [
            {
                id: 'session-1',
                path: '/repo/durable',
                worktree: { path: '/repo/durable' },
                lastKnownGoodPath: '/repo/durable'
            }
        ]);

        expect(session).toEqual(expect.objectContaining({
            path: '/repo/durable',
            worktree: { path: '/repo/durable' },
            lastKnownGoodPath: '/repo/durable'
        }));
    });

    it('session list の upsert patch reorder を純粋関数で処理する', () => {
        const initial = [{ id: 'a', path: '/a' }];
        const upserted = upsertSessionInList(initial, { id: 'b', path: '/b' }, { insertAtStart: true });
        const patched = patchSessionInList(upserted, 'a', { path: '/a2', stale: undefined });
        const reordered = reorderSessionsList(patched, ['a', 'b']);

        expect(initial).toEqual([{ id: 'a', path: '/a' }]);
        expect(reordered).toEqual([
            { id: 'a', path: '/a2' },
            { id: 'b', path: '/b' }
        ]);
    });
});
