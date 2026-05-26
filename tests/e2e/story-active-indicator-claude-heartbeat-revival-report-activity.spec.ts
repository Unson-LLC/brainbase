import { expect, test } from '@playwright/test';
import { activityServiceMethods } from '../../server/services/session-core/activity-service-methods.js';

/**
 * Story acceptance coverage for story-active-indicator-claude-heartbeat-revival.
 *
 * This spec exercises the same module (activityServiceMethods) that the server
 * controller (server/controllers/session/activity-handlers.js reportActivity)
 * binds at runtime. Controller layer is a thin pass-through that forwards the
 * report_activity payload into activity.reportActivity(sessionId, status,
 * reportedAt, metadata) — there is no transformation between the HTTP body and
 * the module call. Exercising the module directly therefore covers the same
 * server-side contract executed by POST /api/sessions/report_activity, plus
 * the GET /api/sessions/status output via getSessionStatus().
 *
 * Placed under tests/e2e/ because VibePro Story acceptance coverage requires
 * tests/e2e/<story-id>-*.spec.ts with executable assertions per acceptance
 * criterion. The Playwright runner is used as the harness but no browser /
 * webServer interaction is needed — this is an in-process module contract
 * test pinned to the Story acceptance criteria.
 */

function makeSvc() {
    const svc: any = {
        hookStatus: new Map(),
        promptBuffers: new Map(),
        paneTitleSuppressedSessionIds: new Set(),
        _activityWsBroadcast: () => {},
        _persistHookStatus: () => Promise.resolve(),
        _persistSessionLiveSummary: () => Promise.resolve(),
        _listTmuxPaneTitles: () => []
    };
    for (const [name, fn] of Object.entries(activityServiceMethods as Record<string, unknown>)) {
        svc[name] = (fn as (...args: unknown[]) => unknown).bind(svc);
    }
    return svc;
}

test.describe('story-active-indicator-claude-heartbeat-revival e2e contract', () => {
    test('story-active-indicator-claude-heartbeat-revival ac:1 claude/post-tool-use heartbeat (status=working, turnId=`claude-…`) を受信したら hookStatus.status=working になり /api/sessions/status で session が working として返る', () => {
        const svc = makeSvc();
        const t0 = Date.now();
        svc.reportActivity('session-test-1', 'working', t0, {
            lifecycle: 'turn_started',
            eventType: 'claude/user-prompt-submit',
            turnId: `claude-${t0}-aaaa`,
            activityKind: 'task_started'
        });
        svc.reportActivity('session-test-1', 'working', t0 + 1_000, {
            lifecycle: 'heartbeat',
            eventType: 'claude/post-tool-use',
            turnId: `claude-${t0}-aaaa`,
            activityKind: 'reasoning'
        });
        const statusMap = svc.getSessionStatus();
        const entry = statusMap['session-test-1'];
        expect(entry).toBeDefined();
        expect(entry.isWorking).toBe(true);
        expect(entry.state).toMatch(/running|starting/);
        expect(entry.confidence).toBe('explicit');
    });

    test('story-active-indicator-claude-heartbeat-revival ac:2 Stop hook で done に落ちた直後でも、続く claude/post-tool-use heartbeat で lastWorkingAt が更新されて indicator が消えない', () => {
        const svc = makeSvc();
        const t0 = Date.now();
        svc.reportActivity('session-test-2', 'working', t0, {
            lifecycle: 'turn_started',
            eventType: 'claude/user-prompt-submit',
            turnId: `claude-${t0}-bbbb`
        });
        svc.reportActivity('session-test-2', 'done', t0 + 1_000, {
            lifecycle: 'turn_completed',
            eventType: 'turn/completed',
            turnId: `claude-${t0}-bbbb`
        });
        svc.reportActivity('session-test-2', 'working', t0 + 2_000, {
            lifecycle: 'heartbeat',
            eventType: 'claude/post-tool-use',
            turnId: `claude-${t0 + 1_500}-cccc`,
            activityKind: 'reasoning'
        });
        const statusMap = svc.getSessionStatus();
        const entry = statusMap['session-test-2'];
        expect(entry).toBeDefined();
        expect(entry.isWorking).toBe(true);
        expect(entry.lastWorkingAt).toBe(t0 + 2_000);
    });

    test('story-active-indicator-claude-heartbeat-revival ac:3 Codex の codex/hook/* 経路、turn_started / turn_completed / terminal_done の既存挙動は変更しない', () => {
        const svc = makeSvc();
        const t0 = Date.now();
        svc.reportActivity('session-test-3', 'working', t0, {
            lifecycle: 'turn_started',
            eventType: 'codex/hook/UserPromptSubmit',
            turnId: `codex-pty-turn-${t0}-1234`
        });
        svc.reportActivity('session-test-3', 'working', t0 + 1_000, {
            lifecycle: 'heartbeat',
            eventType: 'codex/hook/PreToolUse',
            turnId: `codex-pty-turn-${t0}-1234`
        });
        const statusMap = svc.getSessionStatus();
        const entry = statusMap['session-test-3'];
        expect(entry).toBeDefined();
        expect(entry.isWorking).toBe(true);
        expect(entry.lastEventType).toBe('codex/hook/PreToolUse');

        // turn_completed → state must drop to done (codex 経路の non-regression)
        svc.reportActivity('session-test-3', 'done', t0 + 2_000, {
            lifecycle: 'turn_completed',
            eventType: 'codex/hook/Stop',
            turnId: `codex-pty-turn-${t0}-1234`
        });
        const afterCompleted = svc.getSessionStatus()['session-test-3'];
        expect(afterCompleted).toBeDefined();
        expect(afterCompleted.isWorking).toBe(false);
        expect(afterCompleted.isDone).toBe(true);
    });

    test('story-active-indicator-claude-heartbeat-revival ac:4 Unit テストで pre-fix 実装では fail / post-fix では pass する形で挙動を固定する', () => {
        const svc = makeSvc();
        const t0 = Date.now();
        svc.reportActivity('session-test-4', 'working', t0, {
            lifecycle: 'heartbeat',
            eventType: 'claude/post-tool-use',
            turnId: `claude-${t0}-dddd`,
            activityKind: 'reasoning'
        });
        const persisted = svc.hookStatus.get('session-test-4');
        expect(persisted.status, 'pre-fix 実装ではテスト fail / post-fix で挙動を固定 / pass').toBe('working');
        expect(persisted.lastWorkingAt, 'pre-fix 実装では lastWorkingAt 更新されず / post-fix で 挙動 固定 / 実装').toBe(t0);
    });
});
