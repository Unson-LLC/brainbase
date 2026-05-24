import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createSessionRouter } from '../../server/routes/sessions.js';
import { ownershipServiceMethods } from '../../server/services/session-core/ownership-service-methods.js';
import { createSessionServices } from '../../server/services/create-session-services.js';
import {
    buildHibernationEligibility,
    buildRuntimeInventory
} from '../../server/services/session-runtime/runtime-query-methods.js';

describe('session runtime inventory', () => {
    it('exposes hibernation process stopping through the production session services bundle', () => {
        const services = createSessionServices({
            execPromise: vi.fn(async () => ({ stdout: '', stderr: '' })),
            stateStore: { get: () => ({ sessions: [] }), update: vi.fn(async (next) => next) }
        });

        expect(typeof services.runtime.lifecycle.stopSessionOwnedProcesses).toBe('function');
    });

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
                processesByCategory: { codex: 1, mcp: 1, unknown_child: 1 },
                processes: [
                    { pid: 1001, category: 'codex', ownershipStrength: 'strong' },
                    { pid: 1002, category: 'mcp', ownershipStrength: 'strong' },
                    { pid: 1003, category: 'unknown_child', ownershipStrength: 'strong' }
                ]
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
                processesByCategory: { codex: 1, mcp: 1, unknown_child: 0 },
                processes: [
                    { pid: 1001, category: 'codex', ownershipStrength: 'strong' },
                    { pid: 1002, category: 'mcp', ownershipStrength: 'strong' }
                ]
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
                processesByCategory: { codex: 1, mcp: 1, unknown_child: 0 },
                processes: [
                    { pid: 1001, category: 'codex', ownershipStrength: 'strong' },
                    { pid: 1002, category: 'mcp', ownershipStrength: 'strong' }
                ]
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
        expect(eligibility.ownedProcesses).toHaveLength(2);
    });

    it('does not allow weak command substring matches to become stoppable owned processes', () => {
        const inventory = buildRuntimeInventory({
            sessions: [
                {
                    id: 'session-alpha',
                    name: 'build',
                    engine: 'codex',
                    codexThreadId: 'thread-alpha'
                }
            ],
            activeSessions: new Map(),
            psOutput: '901 1 5120 node build-tool-for-another-project.js'
        });
        const inventorySession = inventory.sessions.find(session => session.sessionId === 'session-alpha');
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-alpha',
                name: 'build',
                engine: 'codex',
                codexThreadId: 'thread-alpha'
            },
            inventorySession
        });

        expect(inventorySession.processes[0]).toMatchObject({
            attribution: 'command',
            ownershipStrength: 'weak'
        });
        expect(eligibility.ownedProcesses).toEqual([]);
        expect(eligibility.blockers).toContain('weak_process_ownership');
    });

    it('does not treat tmux server processes as stoppable hibernation-owned processes', () => {
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-alpha',
                engine: 'codex',
                codexThreadId: 'thread-alpha',
                path: '/tmp/session-alpha'
            },
            inventorySession: {
                runtimePresence: 'hot',
                rssKb: 12000,
                processCount: 2,
                processesByCategory: { codex: 1, tmux: 1, unknown_child: 0 },
                processes: [
                    { pid: 1001, category: 'codex', ownershipStrength: 'strong' },
                    { pid: 1002, category: 'tmux', ownershipStrength: 'strong', command: 'tmux new-session -d -s brainbase -c /tmp/session-alpha' }
                ]
            }
        });

        expect(eligibility).toMatchObject({
            eligible: true,
            blockers: []
        });
        expect(eligibility.ownedProcesses).toEqual([
            { pid: 1001, category: 'codex', ownershipStrength: 'strong' }
        ]);
    });

    it('blocks eligibility for sessions that are not active', () => {
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-alpha',
                engine: 'codex',
                intendedState: 'paused',
                codexThreadId: 'thread-alpha'
            },
            inventorySession: {
                runtimePresence: 'hot',
                rssKb: 8000,
                processCount: 1,
                processesByCategory: { codex: 1, unknown_child: 0 },
                processes: [{ pid: 1001, category: 'codex', ownershipStrength: 'strong' }]
            }
        });

        expect(eligibility.eligible).toBe(false);
        expect(eligibility.blockers).toContain('inactive_session_state');
    });


    it('blocks hibernation for non-Codex sessions until a restore contract exists', () => {
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-alpha',
                engine: 'claude'
            },
            inventorySession: {
                runtimePresence: 'hot',
                rssKb: 18000,
                processCount: 1,
                processesByCategory: { claude: 1, unknown_child: 0 },
                processes: [{ pid: 1001, category: 'claude' }]
            }
        });

        expect(eligibility).toMatchObject({
            eligible: false,
            restoreMetadata: {
                restoreStrategy: 'unsupported'
            }
        });
        expect(eligibility.blockers).toContain('unsupported_engine');
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
                processesByCategory: { codex: 1, mcp: 1, unknown_child: 0 },
                processes: [
                    { pid: 1001, category: 'codex', ownershipStrength: 'strong' },
                    { pid: 1002, category: 'mcp', ownershipStrength: 'strong' }
                ]
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
            ownedProcesses: [{ pid: 999, category: 'codex', command: 'codex resume secret-thread' }],
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
            reasons: ['already_cold'],
            ownedProcessCount: 1,
            restoreMetadata: {
                restoreStrategy: 'codex_resume'
            }
        });
        expect(response.body.ownedProcesses).toBeUndefined();
        expect(response.body.restoreMetadata.codexResumeId).toBeUndefined();
        expect(JSON.stringify(response.body)).not.toContain('secret-thread');
    });

    it('hibernates an eligible session and persists runtime metadata', async () => {
        let state = {
            sessions: [{
                id: 'session-alpha',
                name: 'Alpha',
                engine: 'codex',
                intendedState: 'active',
                path: '/tmp/session-alpha',
                codexThreadId: 'thread-alpha'
            }]
        };
        const update = vi.fn(async (nextState) => {
            state = nextState;
            return state;
        });
        const stopSessionOwnedProcesses = vi.fn(async () => ({
            requested: 1,
            killed: [{ pid: 123, category: 'codex', signal: 'SIGTERM' }],
            skipped: [],
            warnings: []
        }));
        const app = express();
        app.use(express.json());
        app.use('/api/sessions', createSessionRouter({
            activity: { promptBuffers: new Map(), getSessionStatus: vi.fn(() => ({})) },
            ownership: { getTerminalOwnerSnapshot: vi.fn(() => null) },
            runtime: {
                query: {
                    getHibernationEligibility: vi.fn(async () => ({
                        sessionId: 'session-alpha',
                        eligible: true,
                        reasons: ['idle_runtime_can_hibernate'],
                        blockers: [],
                        runtimePresence: 'hot',
                        rssKb: 2048,
                        processCount: 1,
                        processesByCategory: { codex: 1, unknown_child: 0 },
                        ownedProcesses: [{ pid: 123, category: 'codex' }],
                        restoreMetadata: {
                            restoreStrategy: 'codex_resume',
                            codexResumeId: 'thread-alpha',
                            codexThreadId: 'thread-alpha'
                        }
                    })),
                    getSessionById: vi.fn((sessionId) => state.sessions.find(session => session.id === sessionId))
                },
                lifecycle: { stopSessionOwnedProcesses }
            },
            terminal: {
                snapshot: {
                    getVisibleContent: vi.fn(async () => 'visible terminal output')
                }
            }
        }, null, { get: () => state, update }));

        const response = await request(app)
            .post('/api/sessions/session-alpha/hibernate')
            .send({})
            .expect(200);

        expect(stopSessionOwnedProcesses).toHaveBeenCalledWith('session-alpha', [{ pid: 123, category: 'codex' }]);
        expect(response.body).toMatchObject({
            success: true,
            intendedState: 'hibernated',
            runtimeState: 'hibernated'
        });
        expect(state.sessions[0]).toMatchObject({
            intendedState: 'hibernated',
            runtimeState: 'hibernated',
            lastRuntimeSnapshot: {
                text: 'visible terminal output'
            },
            restoreStrategy: 'codex_resume',
            restoreCommand: 'codex resume thread-alpha',
            resumeFailureReason: null
        });
    });

    it('rejects manual hibernate for non-active session states before eligibility or process stopping', async () => {
        for (const intendedState of ['paused', 'hibernated', 'broken', 'archived']) {
            const state = {
                sessions: [{
                    id: 'session-alpha',
                    name: 'Alpha',
                    engine: 'codex',
                    intendedState,
                    path: '/tmp/session-alpha',
                    codexThreadId: 'thread-alpha'
                }]
            };
            const getHibernationEligibility = vi.fn();
            const stopSessionOwnedProcesses = vi.fn();
            const app = express();
            app.use(express.json());
            app.use('/api/sessions', createSessionRouter({
                activity: { promptBuffers: new Map(), getSessionStatus: vi.fn(() => ({})) },
                ownership: { getTerminalOwnerSnapshot: vi.fn(() => null) },
                runtime: {
                    query: {
                        getHibernationEligibility,
                        getSessionById: vi.fn((sessionId) => state.sessions.find(session => session.id === sessionId))
                    },
                    lifecycle: { stopSessionOwnedProcesses }
                }
            }, null, { get: () => state, update: vi.fn(async (nextState) => nextState) }));

            const response = await request(app)
                .post('/api/sessions/session-alpha/hibernate')
                .send({})
                .expect(409);

            expect(response.body).toMatchObject({
                error: 'Only active idle sessions can be hibernated',
                intendedState
            });
            expect(getHibernationEligibility).not.toHaveBeenCalled();
            expect(stopSessionOwnedProcesses).not.toHaveBeenCalled();
        }
    });

    it('does not mark a session hibernated when owned process stopping fails', async () => {
        let state = {
            sessions: [{
                id: 'session-alpha',
                name: 'Alpha',
                engine: 'codex',
                intendedState: 'active',
                path: '/tmp/session-alpha',
                codexThreadId: 'thread-alpha'
            }]
        };
        const update = vi.fn(async (nextState) => {
            state = nextState;
            return state;
        });
        const stopSessionOwnedProcesses = vi.fn(async () => {
            const error = new Error('EPERM');
            error.code = 'HIBERNATION_PROCESS_STOP_FAILED';
            throw error;
        });
        const app = express();
        app.use(express.json());
        app.use('/api/sessions', createSessionRouter({
            activity: { promptBuffers: new Map(), getSessionStatus: vi.fn(() => ({})) },
            ownership: { getTerminalOwnerSnapshot: vi.fn(() => null) },
            runtime: {
                query: {
                    getHibernationEligibility: vi.fn(async () => ({
                        sessionId: 'session-alpha',
                        eligible: true,
                        reasons: ['idle_runtime_can_hibernate'],
                        blockers: [],
                        runtimePresence: 'hot',
                        rssKb: 2048,
                        processCount: 1,
                        processesByCategory: { codex: 1, unknown_child: 0 },
                        ownedProcesses: [{ pid: 123, category: 'codex' }],
                        restoreMetadata: { restoreStrategy: 'codex_resume', codexResumeId: 'thread-alpha' }
                    })),
                    getSessionById: vi.fn((sessionId) => state.sessions.find(session => session.id === sessionId))
                },
                lifecycle: { stopSessionOwnedProcesses }
            },
            terminal: {
                snapshot: {
                    getVisibleContent: vi.fn(async () => 'visible terminal output')
                }
            }
        }, null, { get: () => state, update }));

        await request(app)
            .post('/api/sessions/session-alpha/hibernate')
            .send({})
            .expect(500);

        expect(state.sessions[0]).toMatchObject({
            intendedState: 'broken',
            runtimeState: 'broken',
            resumeFailureReason: 'EPERM'
        });
    });

    it('revalidates hibernation blockers after state persistence and before stopping processes', async () => {
        let state = {
            sessions: [{
                id: 'session-alpha',
                name: 'Alpha',
                engine: 'codex',
                intendedState: 'active',
                path: '/tmp/session-alpha',
                codexThreadId: 'thread-alpha'
            }]
        };
        const update = vi.fn(async (nextState) => {
            state = nextState;
            return state;
        });
        const stopSessionOwnedProcesses = vi.fn(async () => ({ requested: 1, killed: [], skipped: [], warnings: [] }));
        const getHibernationEligibility = vi.fn()
            .mockResolvedValueOnce({
                sessionId: 'session-alpha',
                eligible: true,
                reasons: ['idle_runtime_can_hibernate'],
                blockers: [],
                runtimePresence: 'hot',
                rssKb: 2048,
                processCount: 1,
                processesByCategory: { codex: 1, unknown_child: 0 },
                ownedProcesses: [{ pid: 123, category: 'codex' }],
                restoreMetadata: { restoreStrategy: 'codex_resume', codexResumeId: 'thread-alpha' }
            })
            .mockResolvedValueOnce({
                sessionId: 'session-alpha',
                eligible: false,
                reasons: [],
                blockers: ['pending_input'],
                runtimePresence: 'hot',
                rssKb: 2048,
                processCount: 1,
                processesByCategory: { codex: 1, unknown_child: 0 },
                ownedProcesses: [{ pid: 123, category: 'codex' }],
                restoreMetadata: { restoreStrategy: 'codex_resume', codexResumeId: 'thread-alpha' }
            });
        const app = express();
        app.use(express.json());
        app.use('/api/sessions', createSessionRouter({
            activity: { promptBuffers: new Map(), getSessionStatus: vi.fn(() => ({})) },
            ownership: { getTerminalOwnerSnapshot: vi.fn(() => null) },
            runtime: {
                query: {
                    getHibernationEligibility,
                    getSessionById: vi.fn((sessionId) => state.sessions.find(session => session.id === sessionId))
                },
                lifecycle: { stopSessionOwnedProcesses }
            }
        }, null, { get: () => state, update }));

        const response = await request(app)
            .post('/api/sessions/session-alpha/hibernate')
            .send({})
            .expect(409);

        expect(response.body.blockers).toEqual(['pending_input']);
        expect(response.body.ownedProcesses).toBeUndefined();
        expect(getHibernationEligibility).toHaveBeenNthCalledWith(2, 'session-alpha', expect.objectContaining({
            sessionOverride: expect.objectContaining({
                id: 'session-alpha',
                intendedState: 'active'
            })
        }));
        expect(stopSessionOwnedProcesses).not.toHaveBeenCalled();
        expect(state.sessions[0]).toMatchObject({
            intendedState: 'active',
            runtimeState: 'hot',
            hibernatedAt: null,
            hibernateReason: null,
            lastRuntimeSnapshot: null,
            runtimeInventorySummary: null,
            restoreStrategy: null,
            restoreCommand: null,
            resumeFailureReason: null
        });
    });

    it('persists the final revalidated runtime inventory after stopping processes', async () => {
        let state = {
            sessions: [{
                id: 'session-alpha',
                name: 'Alpha',
                engine: 'codex',
                intendedState: 'active',
                path: '/tmp/session-alpha',
                codexThreadId: 'thread-alpha'
            }]
        };
        const update = vi.fn(async (nextState) => {
            state = nextState;
            return state;
        });
        const stopSessionOwnedProcesses = vi.fn(async () => ({
            requested: 1,
            killed: [{ pid: 456, category: 'codex', signal: 'SIGTERM' }],
            skipped: [],
            warnings: []
        }));
        const getHibernationEligibility = vi.fn()
            .mockResolvedValueOnce({
                sessionId: 'session-alpha',
                eligible: true,
                reasons: ['idle_runtime_can_hibernate'],
                blockers: [],
                runtimePresence: 'hot',
                rssKb: 2048,
                processCount: 1,
                processesByCategory: { codex: 1, unknown_child: 0 },
                ownedProcesses: [{ pid: 123, category: 'codex' }],
                restoreMetadata: { restoreStrategy: 'codex_resume', codexResumeId: 'thread-alpha' }
            })
            .mockResolvedValueOnce({
                sessionId: 'session-alpha',
                eligible: true,
                reasons: ['idle_runtime_can_hibernate'],
                blockers: [],
                runtimePresence: 'hot',
                rssKb: 4096,
                processCount: 1,
                processesByCategory: { codex: 1, unknown_child: 0 },
                ownedProcesses: [{ pid: 456, category: 'codex' }],
                restoreMetadata: { restoreStrategy: 'codex_resume', codexResumeId: 'thread-alpha' }
            });
        const app = express();
        app.use(express.json());
        app.use('/api/sessions', createSessionRouter({
            activity: { promptBuffers: new Map(), getSessionStatus: vi.fn(() => ({})) },
            ownership: { getTerminalOwnerSnapshot: vi.fn(() => null) },
            runtime: {
                query: {
                    getHibernationEligibility,
                    getSessionById: vi.fn((sessionId) => state.sessions.find(session => session.id === sessionId))
                },
                lifecycle: { stopSessionOwnedProcesses }
            }
        }, null, { get: () => state, update }));

        await request(app)
            .post('/api/sessions/session-alpha/hibernate')
            .send({})
            .expect(200);

        expect(stopSessionOwnedProcesses).toHaveBeenCalledWith('session-alpha', [{ pid: 456, category: 'codex' }]);
        expect(state.sessions[0].runtimeInventorySummary).toMatchObject({
            runtimePresence: 'hot',
            rssKb: 4096,
            processCount: 1,
            processesByCategory: { codex: 1, unknown_child: 0 },
            stopResult: {
                requested: 1,
                killed: [{ pid: 456, category: 'codex', signal: 'SIGTERM' }]
            }
        });
    });

    it('does not stop owned processes when pre-hibernate state persistence fails', async () => {
        const state = {
            sessions: [{
                id: 'session-alpha',
                name: 'Alpha',
                engine: 'codex',
                intendedState: 'active',
                path: '/tmp/session-alpha',
                codexThreadId: 'thread-alpha'
            }]
        };
        const update = vi.fn(async () => {
            throw new Error('state write failed');
        });
        const stopSessionOwnedProcesses = vi.fn(async () => ({
            requested: 1,
            killed: [{ pid: 123, category: 'codex', signal: 'SIGTERM' }],
            skipped: [],
            warnings: []
        }));
        const app = express();
        app.use(express.json());
        app.use('/api/sessions', createSessionRouter({
            activity: { promptBuffers: new Map(), getSessionStatus: vi.fn(() => ({})) },
            ownership: { getTerminalOwnerSnapshot: vi.fn(() => null) },
            runtime: {
                query: {
                    getHibernationEligibility: vi.fn(async () => ({
                        sessionId: 'session-alpha',
                        eligible: true,
                        reasons: ['idle_runtime_can_hibernate'],
                        blockers: [],
                        runtimePresence: 'hot',
                        rssKb: 2048,
                        processCount: 1,
                        processesByCategory: { codex: 1, unknown_child: 0 },
                        ownedProcesses: [{ pid: 123, category: 'codex' }],
                        restoreMetadata: { restoreStrategy: 'codex_resume', codexResumeId: 'thread-alpha' }
                    })),
                    getSessionById: vi.fn((sessionId) => state.sessions.find(session => session.id === sessionId))
                },
                lifecycle: { stopSessionOwnedProcesses }
            }
        }, null, { get: () => state, update }));

        await request(app)
            .post('/api/sessions/session-alpha/hibernate')
            .send({})
            .expect(500);

        expect(stopSessionOwnedProcesses).not.toHaveBeenCalled();
    });

    it('marks a hibernated session active after runtime resume using persisted engine only', async () => {
        let state = {
            sessions: [{
                id: 'session-alpha',
                name: 'Alpha',
                engine: 'codex',
                intendedState: 'hibernated',
                path: '/tmp/session-alpha',
                codexThreadId: 'thread-alpha'
            }]
        };
        const update = vi.fn(async (nextState) => {
            state = nextState;
            return state;
        });
        const startTtyd = vi.fn(async () => ({ port: 40001, proxyPath: '/console/session-alpha' }));
        const app = express();
        app.use(express.json());
        app.use('/api/sessions', createSessionRouter({
            runtime: {
                query: {
                    getSessionById: vi.fn((sessionId) => state.sessions.find(session => session.id === sessionId))
                },
                lifecycle: { startTtyd }
            }
        }, null, { get: () => state, update }));

        const response = await request(app)
            .post('/api/sessions/session-alpha/resume-runtime')
            .send({ viewerId: 'viewer-1', engine: 'claude' })
            .expect(200);

        expect(startTtyd).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: 'session-alpha',
            initialCommand: '',
            engine: 'codex',
            codexResumeId: 'thread-alpha'
        }));
        expect(response.body).toMatchObject({
            intendedState: 'active',
            runtimeState: 'hot',
            proxyPath: '/console/session-alpha/?viewerId=viewer-1'
        });
    });

    it('rejects resume-runtime when the hibernated record has no Codex restore contract', async () => {
        const state = {
            sessions: [{
                id: 'session-alpha',
                name: 'Alpha',
                engine: 'claude',
                intendedState: 'hibernated',
                path: '/tmp/session-alpha'
            }]
        };
        const startTtyd = vi.fn(async () => ({ port: 40001, proxyPath: '/console/session-alpha' }));
        const app = express();
        app.use(express.json());
        app.use('/api/sessions', createSessionRouter({
            runtime: {
                query: {
                    getSessionById: vi.fn((sessionId) => state.sessions.find(session => session.id === sessionId))
                },
                lifecycle: { startTtyd }
            }
        }, null, { get: () => state, update: vi.fn() }));

        const response = await request(app)
            .post('/api/sessions/session-alpha/resume-runtime')
            .send({ viewerId: 'viewer-1', engine: 'codex' })
            .expect(409);

        expect(response.body).toMatchObject({
            error: 'Session runtime cannot be resumed safely',
            blocker: 'unsupported_engine'
        });
        expect(startTtyd).not.toHaveBeenCalled();
    });

    it('marks a hibernated session broken when runtime resume fails', async () => {
        let state = {
            sessions: [{
                id: 'session-alpha',
                name: 'Alpha',
                engine: 'codex',
                intendedState: 'hibernated',
                path: '/tmp/session-alpha',
                codexThreadId: 'thread-alpha'
            }]
        };
        const update = vi.fn(async (nextState) => {
            state = nextState;
            return state;
        });
        const app = express();
        app.use(express.json());
        app.use('/api/sessions', createSessionRouter({
            runtime: {
                query: {
                    getSessionById: vi.fn((sessionId) => state.sessions.find(session => session.id === sessionId))
                },
                lifecycle: {
                    startTtyd: vi.fn(async () => {
                        throw new Error('tmux session did not become ready');
                    })
                }
            }
        }, null, { get: () => state, update }));

        const response = await request(app)
            .post('/api/sessions/session-alpha/resume-runtime')
            .send({ viewerId: 'viewer-1' })
            .expect(500);

        expect(response.body).toMatchObject({
            error: 'Failed to resume hibernated runtime',
            intendedState: 'broken'
        });
        expect(state.sessions[0]).toMatchObject({
            intendedState: 'broken',
            runtimeState: 'broken',
            resumeFailureReason: 'tmux session did not become ready'
        });
    });

    it('does not mark resumed state persistence failures as runtime restore failures', async () => {
        const state = {
            sessions: [{
                id: 'session-alpha',
                name: 'Alpha',
                engine: 'codex',
                intendedState: 'hibernated',
                path: '/tmp/session-alpha',
                codexThreadId: 'thread-alpha'
            }]
        };
        const update = vi.fn(async () => {
            throw new Error('state write failed');
        });
        const startTtyd = vi.fn(async () => ({ port: 40001, proxyPath: '/console/session-alpha' }));
        const stopTtyd = vi.fn(async () => true);
        const app = express();
        app.use(express.json());
        app.use('/api/sessions', createSessionRouter({
            runtime: {
                query: {
                    getSessionById: vi.fn((sessionId) => state.sessions.find(session => session.id === sessionId))
                },
                lifecycle: { startTtyd, stopTtyd }
            }
        }, null, { get: () => state, update }));

        const response = await request(app)
            .post('/api/sessions/session-alpha/resume-runtime')
            .send({ viewerId: 'viewer-1' })
            .expect(500);

        expect(startTtyd).toHaveBeenCalled();
        expect(stopTtyd).toHaveBeenCalledWith('session-alpha', { preserveTmux: true });
        expect(response.body).toMatchObject({
            error: 'Failed to persist resumed runtime state'
        });
        expect(state.sessions[0].intendedState).toBe('hibernated');
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
