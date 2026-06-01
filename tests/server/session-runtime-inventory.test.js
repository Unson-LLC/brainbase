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
            'pinned'
        ]);
    });

    it('allows strongly attributed unknown child processes under a Brainbase runtime', () => {
        const inventory = buildRuntimeInventory({
            sessions: [
                {
                    id: 'session-alpha',
                    engine: 'codex',
                    codexThreadId: 'thread-alpha'
                }
            ],
            activeSessions: new Map([['session-alpha', { pid: 501 }]]),
            psOutput: [
                '501 1 12000 ttyd -p 40001 -b /console/session-alpha',
                '502 501 3000 opaque-helper-without-session-token'
            ].join('\n')
        });
        const inventorySession = inventory.sessions.find(session => session.sessionId === 'session-alpha');
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-alpha',
                engine: 'codex',
                codexThreadId: 'thread-alpha'
            },
            inventorySession
        });

        expect(inventorySession.processes).toEqual([
            expect.objectContaining({
                pid: 501,
                category: 'ttyd',
                attribution: 'command',
                ownershipStrength: 'strong'
            }),
            expect.objectContaining({
                pid: 502,
                category: 'unknown_child',
                attribution: 'parent',
                ownershipStrength: 'strong'
            })
        ]);
        expect(eligibility).toMatchObject({
            eligible: true,
            blockers: []
        });
        expect(eligibility.ownedProcesses.map(process => process.pid)).toEqual([501, 502]);
    });

    it('does not trust a stale active session pid without command evidence', () => {
        const inventory = buildRuntimeInventory({
            sessions: [
                {
                    id: 'session-alpha',
                    engine: 'codex',
                    codexThreadId: 'thread-alpha'
                }
            ],
            activeSessions: new Map([['session-alpha', { pid: 601 }]]),
            psOutput: [
                '601 1 9000 unrelated-long-running-process',
                '602 601 3000 unrelated-child-process'
            ].join('\n')
        });
        const inventorySession = inventory.sessions.find(session => session.sessionId === 'session-alpha');
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-alpha',
                engine: 'codex',
                codexThreadId: 'thread-alpha'
            },
            inventorySession
        });

        expect(inventorySession).toMatchObject({
            runtimePresence: 'hot',
            processCount: 0,
            rssKb: 0
        });
        expect(inventory.unattributed.map(process => process.pid)).toEqual([601, 602]);
        expect(eligibility.eligible).toBe(false);
        expect(eligibility.ownedProcesses).toEqual([]);
    });

    it('does not treat broad workspace paths as strong session ownership evidence', () => {
        const inventory = buildRuntimeInventory({
            sessions: [
                {
                    id: 'brainbase',
                    name: 'brainbase',
                    engine: 'codex',
                    intendedState: 'active',
                    path: '/Users/ksato/workspace'
                }
            ],
            activeSessions: new Map(),
            psOutput: [
                '200 1 2048 npm run typecheck --prefix /Users/ksato/workspace/code/brainbase',
                '201 1 1024 node /Users/ksato/workspace/code/vibepro/src/cli.js'
            ].join('\n')
        });

        const inventorySession = inventory.sessions.find(session => session.sessionId === 'brainbase');
        expect(inventorySession.processCount).toBe(0);
        expect(inventory.unattributed.map(process => process.pid)).toEqual([200, 201]);
    });

    it('does not treat project root paths as strong session ownership evidence', () => {
        const inventory = buildRuntimeInventory({
            sessions: [
                {
                    id: 'brainbase',
                    name: 'brainbase',
                    engine: 'codex',
                    intendedState: 'active',
                    path: '/Users/ksato/workspace/code/brainbase',
                    codexThreadId: '00000000-0000-4000-8000-000000000001'
                }
            ],
            activeSessions: new Map(),
            psOutput: '205 1 2048 npm run typecheck --prefix /Users/ksato/workspace/code/brainbase'
        });
        const inventorySession = inventory.sessions.find(session => session.sessionId === 'brainbase');
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'brainbase',
                engine: 'codex',
                intendedState: 'active',
                codexThreadId: '00000000-0000-4000-8000-000000000001'
            },
            inventorySession
        });

        expect(inventorySession.processCount).toBe(0);
        expect(inventory.unattributed.map(process => process.pid)).toEqual([205]);
        expect(eligibility.eligible).toBe(false);
        expect(eligibility.ownedProcesses).toEqual([]);
    });

    it('does not treat ordinary project names containing session as strong runtime paths', () => {
        const projectPath = '/Users/ksato/workspace/code/customer-session-service';
        const inventory = buildRuntimeInventory({
            sessions: [
                {
                    id: 'session-customer',
                    name: 'Customer Session Service',
                    engine: 'codex',
                    intendedState: 'active',
                    path: projectPath,
                    codexThreadId: '00000000-0000-4000-8000-000000000002'
                }
            ],
            activeSessions: new Map(),
            psOutput: `206 1 2048 npm run typecheck --prefix ${projectPath}`
        });
        const inventorySession = inventory.sessions.find(session => session.sessionId === 'session-customer');
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-customer',
                engine: 'codex',
                intendedState: 'active',
                codexThreadId: '00000000-0000-4000-8000-000000000002'
            },
            inventorySession
        });

        expect(inventorySession.processCount).toBe(0);
        expect(inventory.unattributed.map(process => process.pid)).toEqual([206]);
        expect(eligibility.eligible).toBe(false);
        expect(eligibility.ownedProcesses).toEqual([]);
    });

    it('does not treat ordinary project names containing worktree as strong runtime paths', () => {
        const projectPath = '/Users/ksato/workspace/code/customer-worktree-service';
        const inventory = buildRuntimeInventory({
            sessions: [
                {
                    id: 'session-worktree-project',
                    name: 'Customer Worktree Service',
                    engine: 'codex',
                    intendedState: 'active',
                    path: projectPath,
                    codexThreadId: '00000000-0000-4000-8000-000000000003'
                }
            ],
            activeSessions: new Map(),
            psOutput: `207 1 2048 npm run typecheck --prefix ${projectPath}`
        });
        const inventorySession = inventory.sessions.find(session => session.sessionId === 'session-worktree-project');
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-worktree-project',
                engine: 'codex',
                intendedState: 'active',
                codexThreadId: '00000000-0000-4000-8000-000000000003'
            },
            inventorySession
        });

        expect(inventorySession.processCount).toBe(0);
        expect(inventory.unattributed.map(process => process.pid)).toEqual([207]);
        expect(eligibility.eligible).toBe(false);
        expect(eligibility.ownedProcesses).toEqual([]);
    });

    it('does not treat generic worktrees project roots as strong runtime paths', () => {
        const projectPath = '/Users/ksato/workspace/code/worktrees/customer-worktree-service';
        const inventory = buildRuntimeInventory({
            sessions: [
                {
                    id: 'session-generic-worktree',
                    name: 'Generic Worktree Project',
                    engine: 'codex',
                    intendedState: 'active',
                    path: projectPath,
                    codexThreadId: '00000000-0000-4000-8000-000000000004'
                }
            ],
            activeSessions: new Map(),
            psOutput: `208 1 2048 npm run typecheck --prefix ${projectPath}`
        });
        const inventorySession = inventory.sessions.find(session => session.sessionId === 'session-generic-worktree');
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-generic-worktree',
                engine: 'codex',
                intendedState: 'active',
                codexThreadId: '00000000-0000-4000-8000-000000000004'
            },
            inventorySession
        });

        expect(inventorySession.processCount).toBe(0);
        expect(inventory.unattributed.map(process => process.pid)).toEqual([208]);
        expect(eligibility.eligible).toBe(false);
        expect(eligibility.ownedProcesses).toEqual([]);
    });

    it('does not treat generic worktrees session-named project roots as strong stoppable paths', () => {
        const projectPath = '/Users/ksato/workspace/code/worktrees/session-service';
        const inventory = buildRuntimeInventory({
            sessions: [
                {
                    id: 'session-service',
                    name: 'Session Service',
                    engine: 'codex',
                    intendedState: 'active',
                    path: projectPath,
                    codexThreadId: '00000000-0000-4000-8000-000000000005'
                }
            ],
            activeSessions: new Map(),
            psOutput: `211 1 2048 npm run typecheck --prefix ${projectPath}`
        });
        const inventorySession = inventory.sessions.find(session => session.sessionId === 'session-service');
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-service',
                engine: 'codex',
                intendedState: 'active',
                codexThreadId: '00000000-0000-4000-8000-000000000005'
            },
            inventorySession
        });

        expect(inventorySession.processCount).toBe(1);
        expect(inventorySession.processes[0]).toMatchObject({
            pid: 211,
            ownershipStrength: 'weak'
        });
        expect(eligibility.eligible).toBe(false);
        expect(eligibility.blockers).toContain('weak_process_ownership');
        expect(eligibility.ownedProcesses).toEqual([]);
    });

    it('keeps canonical UNSON drive brainbase worktree session paths as strong ownership evidence', () => {
        const worktreePath = '/Volumes/UNSON-DRIVE/brainbase-worktrees/session-alpha';
        const inventory = buildRuntimeInventory({
            sessions: [
                {
                    id: 'session-alpha',
                    name: 'Alpha',
                    engine: 'codex',
                    intendedState: 'active',
                    path: worktreePath
                }
            ],
            activeSessions: new Map(),
            psOutput: `209 1 2048 node ${worktreePath}/.claude/mcp/server.js`
        });

        const inventorySession = inventory.sessions.find(session => session.sessionId === 'session-alpha');
        expect(inventorySession.processCount).toBe(1);
        expect(inventorySession.processes[0]).toMatchObject({
            pid: 209,
            ownershipStrength: 'strong'
        });
    });

    it('keeps specific session worktree paths as strong ownership evidence', () => {
        const inventory = buildRuntimeInventory({
            sessions: [
                {
                    id: 'session-alpha',
                    name: 'Alpha',
                    engine: 'codex',
                    intendedState: 'active',
                    path: '/Users/ksato/workspace/code/brainbase-worktrees-session-alpha'
                }
            ],
            activeSessions: new Map(),
            psOutput: '210 1 2048 node /Users/ksato/workspace/code/brainbase-worktrees-session-alpha/.claude/mcp/server.js'
        });

        const inventorySession = inventory.sessions.find(session => session.sessionId === 'session-alpha');
        expect(inventorySession.processCount).toBe(1);
        expect(inventorySession.processes[0]).toMatchObject({
            pid: 210,
            ownershipStrength: 'strong'
        });
    });

    it('keeps weak unknown child ownership blocked', () => {
        const eligibility = buildHibernationEligibility({
            session: {
                id: 'session-alpha',
                engine: 'codex',
                codexThreadId: 'thread-alpha'
            },
            inventorySession: {
                runtimePresence: 'hot',
                rssKb: 3000,
                processCount: 1,
                processesByCategory: { unknown_child: 1 },
                processes: [
                    { pid: 1003, category: 'unknown_child', ownershipStrength: 'weak' }
                ]
            }
        });

        expect(eligibility.eligible).toBe(false);
        expect(eligibility.blockers).toContain('unknown_process_ownership');
        expect(eligibility.blockers).toContain('weak_process_ownership');
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
            psOutput: '901 1 5120 node session-alpha-helper-for-another-project.js'
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
        const codexAppServerTranscript = {
            stopSession: vi.fn(async () => true)
        };
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
            codexAppServerTranscript,
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
        expect(codexAppServerTranscript.stopSession).toHaveBeenCalledWith('session-alpha', { status: 'hibernated' });
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

    it('stops Codex App Server transcript runtime when a session is manually stopped', async () => {
        let state = {
            sessions: [{
                id: 'session-alpha',
                name: 'Alpha',
                engine: 'codex',
                intendedState: 'active',
                path: '/tmp/session-alpha',
                codexAppServer: { threadId: 'thread-alpha' }
            }]
        };
        const update = vi.fn(async (nextState) => {
            state = nextState;
            return state;
        });
        const stopTtyd = vi.fn(async () => true);
        const codexAppServerTranscript = {
            stopSession: vi.fn(async () => true)
        };
        const app = express();
        app.use(express.json());
        app.use('/api/sessions', createSessionRouter({
            runtime: {
                lifecycle: { stopTtyd }
            },
            codexAppServerTranscript
        }, null, { get: () => state, update }));

        await request(app)
            .post('/api/sessions/session-alpha/stop')
            .send({})
            .expect(200);

        expect(stopTtyd).toHaveBeenCalledWith('session-alpha', { preserveTmux: false });
        expect(codexAppServerTranscript.stopSession).toHaveBeenCalledWith('session-alpha', { status: 'paused' });
        expect(state.sessions[0]).toMatchObject({
            intendedState: 'paused',
            pausedReason: 'manual'
        });
    });

    it('stops Codex App Server transcript runtime even when no ttyd runtime is stopped', async () => {
        const state = {
            sessions: [{
                id: 'session-alpha',
                name: 'Alpha',
                engine: 'codex',
                intendedState: 'active',
                path: '/tmp/session-alpha',
                codexAppServer: { threadId: 'thread-alpha' }
            }]
        };
        const update = vi.fn(async (nextState) => nextState);
        const stopTtyd = vi.fn(async () => false);
        const codexAppServerTranscript = {
            stopSession: vi.fn(async () => true)
        };
        const app = express();
        app.use(express.json());
        app.use('/api/sessions', createSessionRouter({
            runtime: {
                lifecycle: { stopTtyd }
            },
            codexAppServerTranscript
        }, null, { get: () => state, update }));

        await request(app)
            .post('/api/sessions/session-alpha/stop')
            .send({})
            .expect(404);

        expect(stopTtyd).toHaveBeenCalledWith('session-alpha', { preserveTmux: false });
        expect(codexAppServerTranscript.stopSession).toHaveBeenCalledWith('session-alpha', { status: 'paused' });
        expect(update).not.toHaveBeenCalled();
    });

    it('stops Codex App Server transcript runtime before archiving a session', async () => {
        let state = {
            sessions: [{
                id: 'session-alpha',
                name: 'Alpha',
                engine: 'codex',
                intendedState: 'active',
                path: '/tmp/session-alpha',
                codexAppServer: { threadId: 'thread-alpha' }
            }]
        };
        const update = vi.fn(async (nextState) => {
            state = nextState;
            return state;
        });
        const stopTtyd = vi.fn(async () => true);
        const codexAppServerTranscript = {
            stopSession: vi.fn(async () => true)
        };
        const archiveFinalizer = {
            enqueue: vi.fn(async () => {})
        };
        const app = express();
        app.use(express.json());
        app.use('/api/sessions', createSessionRouter({
            runtime: {
                lifecycle: { stopTtyd }
            },
            codexAppServerTranscript,
            archiveFinalizer
        }, null, { get: () => state, update }));

        await request(app)
            .post('/api/sessions/session-alpha/archive')
            .send({})
            .expect(200);

        expect(stopTtyd).toHaveBeenCalledWith('session-alpha');
        expect(codexAppServerTranscript.stopSession).toHaveBeenCalledWith('session-alpha', { status: 'archived' });
        expect(archiveFinalizer.enqueue).toHaveBeenCalledWith('session-alpha');
        expect(state.sessions[0]).toMatchObject({
            intendedState: 'archived',
            archive: { status: 'queued' }
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

        const response = await request(app)
            .post('/api/sessions/session-alpha/hibernate')
            .send({})
            .expect(500);

        expect(response.body).toMatchObject({
            error: 'Failed to hibernate session',
            intendedState: 'active',
            runtimeState: 'hot',
            hibernateFailureReason: 'EPERM'
        });
        expect(state.sessions[0]).toMatchObject({
            intendedState: 'active',
            runtimeState: 'hot',
            hibernateFailureReason: 'EPERM',
            lastRuntimeSnapshot: null,
            runtimeInventorySummary: null,
            restoreStrategy: null,
            restoreCommand: null,
            resumeFailureReason: null
        });
    });

    it('marks a session broken when owned process stopping fails after a partial stop', async () => {
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
            const error = new Error('Failed to stop one or more session-owned processes: 456: EPERM');
            error.code = 'HIBERNATION_PROCESS_STOP_FAILED';
            error.killed = [{ pid: 123, category: 'codex', signal: 'SIGTERM' }];
            error.warnings = [{ pid: 456, message: 'EPERM' }];
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
                        processCount: 2,
                        processesByCategory: { codex: 1, unknown_child: 1 },
                        ownedProcesses: [
                            { pid: 123, category: 'codex' },
                            { pid: 456, category: 'unknown_child' }
                        ],
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

        const response = await request(app)
            .post('/api/sessions/session-alpha/hibernate')
            .send({})
            .expect(500);

        expect(response.body).toMatchObject({
            error: 'Failed to hibernate session',
            intendedState: 'broken',
            runtimeState: 'broken',
            hibernatePartialStop: true
        });
        expect(state.sessions[0]).toMatchObject({
            intendedState: 'broken',
            runtimeState: 'broken',
            hibernatePartialStop: true
        });
    });

    it('marks a session broken when transcript cleanup fails after owned processes stop', async () => {
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
            killed: [{ pid: 123, category: 'codex', signal: 'SIGTERM' }],
            warnings: []
        }));
        const codexAppServerTranscript = {
            stopSession: vi.fn(async () => {
                throw new Error('transcript stop failed');
            })
        };
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
            },
            codexAppServerTranscript
        }, null, { get: () => state, update }));

        const response = await request(app)
            .post('/api/sessions/session-alpha/hibernate')
            .send({})
            .expect(500);

        expect(response.body).toMatchObject({
            error: 'Failed to hibernate session',
            intendedState: 'broken',
            runtimeState: 'broken',
            hibernateFailureReason: 'transcript stop failed',
            hibernatePartialStop: true
        });
        expect(codexAppServerTranscript.stopSession).toHaveBeenCalledWith('session-alpha', { status: 'hibernated' });
        expect(state.sessions[0]).toMatchObject({
            intendedState: 'broken',
            runtimeState: 'broken',
            hibernatePartialStop: true
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
                codexThreadId: 'thread-alpha',
                hibernateFailureReason: 'old hibernate failure',
                hibernatePartialStop: true
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
        expect(state.sessions[0]).toMatchObject({
            intendedState: 'active',
            runtimeState: 'hot',
            resumeFailureReason: null,
            hibernateFailureReason: null,
            hibernatePartialStop: false
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
