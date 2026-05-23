import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createSessionRouter } from '../../server/routes/sessions.js';
import { buildRuntimeInventory } from '../../server/services/session-runtime/runtime-query-methods.js';

describe('session runtime inventory', () => {
    it('attributes Codex runtime processes and aggregates RSS by session', () => {
        const inventory = buildRuntimeInventory({
            sessions: [
                {
                    id: 'session-alpha',
                    name: 'Alpha',
                    path: '/tmp/worktrees/session-alpha',
                    intendedState: 'active',
                    codexThreadId: 'thread-alpha'
                }
            ],
            activeSessions: new Map([['session-alpha', { pid: 101 }]]),
            psOutput: [
                '101 1 12000 /usr/local/bin/codex resume thread-alpha',
                '102 101 8000 codex app-server --session session-alpha',
                '103 101 4000 python codex-pty-shim.py --session session-alpha',
                '104 1 3000 tmux new-session -s session-alpha',
                '105 1 2000 ttyd -p 40001 tmux attach -t session-alpha',
                '106 101 1000 node /tmp/worktrees/session-alpha/.claude/mcp/server.js',
                '999 1 500 node /tmp/not-a-session/mcp/other.js'
            ].join('\n')
        });

        expect(inventory.totals).toMatchObject({
            sessionCount: 1,
            hotSessions: 1,
            coldSessions: 0,
            rssKb: 30000,
            processCount: 6,
            unattributedProcessCount: 1
        });
        expect(inventory.sessions[0]).toMatchObject({
            sessionId: 'session-alpha',
            runtimePresence: 'hot',
            rssKb: 30000,
            processCount: 6,
            processesByCategory: {
                codex: 1,
                codex_app_server: 1,
                pty_shim: 1,
                tmux: 1,
                ttyd: 1,
                mcp: 1,
                unknown_child: 0
            }
        });
        expect(inventory.unattributed[0]).toMatchObject({
            category: 'mcp',
            reason: 'no_session_match'
        });
    });

    it('keeps cold sessions visible with zero runtime RSS', () => {
        const inventory = buildRuntimeInventory({
            sessions: [
                { id: 'session-cold', name: 'Cold', intendedState: 'active' }
            ],
            activeSessions: new Map(),
            psOutput: ''
        });

        expect(inventory.sessions).toHaveLength(1);
        expect(inventory.sessions[0]).toMatchObject({
            sessionId: 'session-cold',
            runtimePresence: 'cold',
            rssKb: 0,
            processCount: 0
        });
        expect(inventory.totals).toMatchObject({
            hotSessions: 0,
            coldSessions: 1,
            rssKb: 0
        });
    });

    it('does not guess ownership when a process matches multiple sessions', () => {
        const inventory = buildRuntimeInventory({
            sessions: [
                { id: 'session-a', path: '/tmp/session-a' },
                { id: 'session-b', path: '/tmp/session-b' }
            ],
            activeSessions: new Map(),
            psOutput: '201 1 777 tmux attach -t session-a-and-session-b'
        });

        expect(inventory.totals.rssKb).toBe(0);
        expect(inventory.unattributed).toHaveLength(1);
        expect(inventory.unattributed[0]).toMatchObject({
            category: 'tmux',
            matchedSessionIds: ['session-a', 'session-b'],
            reason: 'matched_multiple_sessions'
        });
    });

    it('serves the inventory through the sessions router before the :id route', async () => {
        const app = express();
        app.use('/api/sessions', createSessionRouter({
            runtime: {
                query: {
                    getRuntimeInventory: vi.fn(async () => ({
                        generatedAt: '2026-05-23T00:00:00.000Z',
                        sessions: [],
                        totals: {
                            sessionCount: 0,
                            hotSessions: 0,
                            coldSessions: 0,
                            rssKb: 0,
                            processCount: 0,
                            unattributedProcessCount: 0
                        },
                        unattributed: []
                    }))
                }
            }
        }, null, { get: () => ({ sessions: [] }) }));

        const response = await request(app)
            .get('/api/sessions/runtime/inventory')
            .expect(200);

        expect(response.body).toMatchObject({
            sessions: [],
            totals: {
                sessionCount: 0,
                rssKb: 0
            },
            unattributed: []
        });
    });

    it('adds runtime inventory posture to existing UI summaries without mutating sessions', async () => {
        const sessions = [
            { id: 'session-hot', name: 'Hot Session', intendedState: 'active' }
        ];
        const stateStore = { get: vi.fn(() => ({ sessions })) };
        const app = express();
        app.use('/api/sessions', createSessionRouter({
            runtime: {
                query: {
                    getRuntimeInventory: vi.fn(async () => ({
                        sessions: [
                            {
                                sessionId: 'session-hot',
                                runtimePresence: 'hot',
                                rssKb: 2048,
                                processCount: 2,
                                processesByCategory: { codex: 1, mcp: 1 }
                            }
                        ],
                        totals: {},
                        unattributed: []
                    }))
                }
            }
        }, null, stateStore));

        const response = await request(app)
            .get('/api/sessions/ui-summaries?ids=session-hot')
            .expect(200);

        expect(response.body['session-hot'].runtimeInventory).toEqual({
            runtimePresence: 'hot',
            rssKb: 2048,
            processCount: 2,
            processesByCategory: { codex: 1, mcp: 1 }
        });
        expect(sessions[0]).not.toHaveProperty('runtimeInventory');
    });
});
