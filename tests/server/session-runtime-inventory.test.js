import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createSessionRouter } from '../../server/routes/sessions.js';
import { ownershipServiceMethods } from '../../server/services/session-core/ownership-service-methods.js';
import {
    buildHibernationEligibility,
    buildRuntimeInventory
} from '../../server/services/session-runtime/runtime-query-methods.js';

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

    it('attributes child processes through a uniquely matched parent process', () => {
        const inventory = buildRuntimeInventory({
            sessions: [
                {
                    id: 'session-alpha',
                    path: '/tmp/worktrees/session-alpha',
                    codexThreadId: 'thread-alpha'
                }
            ],
            activeSessions: new Map(),
            psOutput: [
                '301 1 9000 /usr/local/bin/codex resume thread-alpha',
                '302 301 7000 node /Users/ksato/.cache/opaque-mcp-server/index.js',
                '303 302 3000 node worker-without-session-token.js'
            ].join('\n')
        });

        expect(inventory.sessions[0]).toMatchObject({
            runtimePresence: 'hot',
            rssKb: 19000,
            processCount: 3
        });
        expect(inventory.sessions[0].processes.map(process => process.attribution)).toEqual([
            'command',
            'parent',
            'parent'
        ]);
        expect(inventory.unattributed).toEqual([]);
    });

    it('keeps unmatched unknown child processes visible as unattributed', () => {
        const inventory = buildRuntimeInventory({
            sessions: [
                { id: 'session-alpha', path: '/tmp/worktrees/session-alpha' }
            ],
            activeSessions: new Map(),
            psOutput: '401 1 1234 opaque-helper-without-session-token'
        });

        expect(inventory.sessions[0]).toMatchObject({
            rssKb: 0,
            processCount: 0
        });
        expect(inventory.unattributed).toHaveLength(1);
        expect(inventory.unattributed[0]).toMatchObject({
            pid: 401,
            category: 'unknown_child',
            matchedSessionIds: [],
            reason: 'no_session_match'
        });
    });

    it('builds a read-only hibernation eligibility response with explicit blockers', () => {
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-alpha',
                engine: 'codex',
                runtimePinned: true,
                codexThreadId: 'thread-alpha'
            },
            inventorySession: {
                runtimePresence: 'hot',
                rssKb: 19000,
                processCount: 3,
                processesByCategory: { codex: 1, mcp: 1, unknown_child: 1 }
            },
            activityStatus: { isWorking: true, activeTurnCount: 1 },
            owner: { ownerViewerId: 'viewer-1' },
            pendingInput: 'draft prompt'
        });

        expect(eligibility).toMatchObject({
            sessionId: 'session-alpha',
            eligible: false,
            runtimePresence: 'hot',
            rssKb: 19000,
            processCount: 3,
            restoreMetadata: {
                restoreStrategy: 'codex_resume',
                codexResumeId: 'thread-alpha'
            }
        });
        expect(eligibility.blockers).toEqual([
            'active_turn',
            'pending_input',
            'active_owner',
            'pinned',
            'unknown_process_ownership'
        ]);
    });

    it('blocks hibernation for pending startup, missing restore metadata, and ambiguous processes', () => {
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-alpha',
                engine: 'codex',
                startupStatus: 'pending'
            },
            inventorySession: {
                runtimePresence: 'hot',
                rssKb: 18000,
                processCount: 2,
                processesByCategory: { codex: 1, mcp: 1, unknown_child: 0 }
            },
            ambiguousProcesses: [
                {
                    pid: 501,
                    category: 'mcp',
                    matchedSessionIds: ['session-alpha', 'session-beta']
                }
            ]
        });

        expect(eligibility).toMatchObject({
            eligible: false,
            runtimePresence: 'hot',
            ambiguousProcessCount: 1,
            restoreMetadata: {
                restoreStrategy: 'codex_resume',
                codexResumeId: null
            }
        });
        expect(eligibility.blockers).toEqual([
            'pending_startup',
            'missing_restore_metadata',
            'unknown_process_ownership'
        ]);
    });

    it('allows an idle hot Codex session with known processes and restore metadata', () => {
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-alpha',
                engine: 'codex',
                codexThreadId: 'thread-alpha'
            },
            inventorySession: {
                runtimePresence: 'hot',
                rssKb: 18000,
                processCount: 2,
                processesByCategory: { codex: 1, mcp: 1, unknown_child: 0 }
            }
        });

        expect(eligibility).toMatchObject({
            eligible: true,
            reasons: ['idle_runtime_can_hibernate'],
            blockers: [],
            restoreMetadata: {
                codexResumeId: 'thread-alpha'
            }
        });
    });

    it('accepts legacy Codex conversationId as restore metadata', () => {
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-alpha',
                engine: 'codex',
                conversationSummary: {
                    lastConversation: {
                        conversationId: 'codex-session-141b7a15-e5fe-472d-a40a-01ea5f576f66'
                    }
                }
            },
            inventorySession: {
                runtimePresence: 'hot',
                rssKb: 18000,
                processCount: 2,
                processesByCategory: { codex: 1, mcp: 1, unknown_child: 0 }
            }
        });

        expect(eligibility).toMatchObject({
            eligible: true,
            blockers: [],
            restoreMetadata: {
                codexResumeId: '141b7a15-e5fe-472d-a40a-01ea5f576f66'
            }
        });
    });

    it('does not report expired terminal owners as active blockers', () => {
        const context = {
            TERMINAL_OWNER_TTL_MS: 1000,
            _getTerminalOwnerEntry: ownershipServiceMethods._getTerminalOwnerEntry,
            terminalOwners: new Map([[
                'session-alpha',
                {
                    viewerId: 'viewer-1',
                    viewerLabel: 'Reviewer',
                    claimedAt: Date.now() - 5000,
                    lastSeenAt: Date.now() - 5000
                }
            ]])
        };

        const owner = ownershipServiceMethods.getTerminalOwnerSnapshot.call(context, 'session-alpha');

        expect(owner).toBeNull();
        expect(context.terminalOwners.has('session-alpha')).toBe(false);
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

    it('serves hibernation eligibility through the sessions router before runtime routes', async () => {
        const getHibernationEligibility = vi.fn(async () => ({
            sessionId: 'session-alpha',
            eligible: false,
            reasons: ['already_cold'],
            blockers: [],
            runtimePresence: 'cold',
            rssKb: 0,
            processCount: 0,
            processesByCategory: {},
            ambiguousProcessCount: 0,
            restoreMetadata: {
                restoreStrategy: 'codex_resume',
                codexResumeId: 'thread-alpha',
                codexThreadId: 'thread-alpha'
            }
        }));
        const app = express();
        app.use('/api/sessions', createSessionRouter({
            activity: {
                promptBuffers: new Map(),
                getSessionStatus: vi.fn(() => ({}))
            },
            ownership: {
                getTerminalOwnerSnapshot: vi.fn(() => null)
            },
            runtime: {
                query: {
                    getHibernationEligibility,
                    getSessionById: vi.fn((sessionId) => ({
                        id: sessionId,
                        name: 'Alpha',
                        engine: 'codex',
                        codexThreadId: 'thread-alpha'
                    }))
                }
            }
        }, null, {
            get: () => ({
                sessions: [{
                    id: 'session-alpha',
                    name: 'Alpha',
                    engine: 'codex',
                    codexThreadId: 'thread-alpha'
                }]
            })
        }));

        const response = await request(app)
            .get('/api/sessions/session-alpha/hibernate/eligibility')
            .expect(200);

        expect(getHibernationEligibility).toHaveBeenCalledWith('session-alpha', {
            activityStatus: null,
            owner: null,
            pendingInput: ''
        });
        expect(response.body).toMatchObject({
            sessionId: 'session-alpha',
            eligible: false,
            reasons: ['already_cold']
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
