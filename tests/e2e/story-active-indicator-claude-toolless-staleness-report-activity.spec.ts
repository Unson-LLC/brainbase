import { expect, test } from '@playwright/test';
import { activityServiceMethods } from '../../server/services/session-core/activity-service-methods.js';

/**
 * Story acceptance coverage for story-active-indicator-claude-toolless-staleness.
 *
 * This spec exercises the same module (activityServiceMethods) that the server
 * controller (server/controllers/session/activity-handlers.js reportActivity)
 * binds at runtime. The controller layer is a thin pass-through that forwards
 * the report_activity payload into activity.reportActivity(sessionId, status,
 * reportedAt, metadata) with no transformation, so exercising the module
 * directly covers the same server-side contract executed by
 * POST /api/sessions/report_activity, plus the GET /api/sessions/status output
 * via getSessionStatus().
 *
 * The fix under test: _buildStatusForSession widens the working-staleness window
 * from 5min (WORKING_TIMEOUT) to 30min (CLAUDE_WORKING_TIMEOUT) for an explicitly
 * open Claude working turn, because Claude's activity-bridge only heartbeats on
 * PostToolUse and tool-less stretches legitimately exceed 5min. Codex is
 * unchanged at 5min.
 *
 * Placed under tests/e2e/ because VibePro Story acceptance coverage requires
 * tests/e2e/<story-id>-*.spec.ts with executable assertions per acceptance
 * criterion. The Playwright runner is the harness but no browser / webServer
 * interaction is needed — this is an in-process module contract test pinned to
 * the Story acceptance criteria.
 */

const MINUTE = 60 * 1000;

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
    // bind ループが activityServiceMethods 内の実 _persistHookStatus 等で stub を
    // 上書きするため、永続化系は loop の後に no-op で固定する (stateStore 無しで
    // patchSession に到達して落ちる副作用を排除し、staleness 契約だけを検証する)。
    svc._persistHookStatus = () => Promise.resolve();
    svc._persistSessionLiveSummary = () => Promise.resolve();
    svc._activityWsBroadcast = () => {};
    return svc;
}

test.describe('story-active-indicator-claude-toolless-staleness e2e contract', () => {
    test('story-active-indicator-claude-toolless-staleness ac:1 6 分間 heartbeat の無い開いた claude turn でも /api/sessions/status が当該 session を isWorking:true で返す', () => {
        const svc = makeSvc();
        const startedAt = Date.now() - 6 * MINUTE;
        svc.reportActivity('session-tool-less-1', 'working', startedAt, {
            lifecycle: 'turn_started',
            eventType: 'claude/user-prompt-submit',
            turnId: `claude-${startedAt}-aaaa`,
            activityKind: 'task_started'
        });
        const entry = svc.getSessionStatus()['session-tool-less-1'];
        expect(entry, 'tool-less 6min claude turn keeps indicator').toBeDefined();
        expect(entry.isWorking).toBe(true);
        expect(entry.state).toMatch(/running|starting/);
    });

    test('story-active-indicator-claude-toolless-staleness ac:2 30 分境界の固定: 29 分(窓内)はまだ working、31 分(窓外)は消える', () => {
        // 上限境界そのものを固定する。pre-fix の 5 分窓では 29 分ケースが null になり
        // この test は fail する (fix-sensitive)。31 分ケースと対で 30 分窓を bracket する。
        const inWindow = makeSvc();
        const at29 = Date.now() - 29 * MINUTE;
        inWindow.reportActivity('session-tool-less-2a', 'working', at29, {
            lifecycle: 'turn_started',
            eventType: 'claude/user-prompt-submit',
            turnId: `claude-${at29}-b29b`,
            activityKind: 'task_started'
        });
        const within = inWindow.getSessionStatus()['session-tool-less-2a'];
        expect(within, '29min (within 30min window) claude turn stays working').toBeDefined();
        expect(within.isWorking).toBe(true);

        const expired = makeSvc();
        const at31 = Date.now() - 31 * MINUTE;
        expired.reportActivity('session-tool-less-2b', 'working', at31, {
            lifecycle: 'turn_started',
            eventType: 'claude/user-prompt-submit',
            turnId: `claude-${at31}-b31b`,
            activityKind: 'task_started'
        });
        expect(expired.getSessionStatus()['session-tool-less-2b'], '31min stale claude turn is dropped').toBeUndefined();
    });

    test('story-active-indicator-claude-toolless-staleness ac:2b 30 分を超えた開いた claude turn は死んだとみなし getSessionStatus から消える', () => {
        const svc = makeSvc();
        const startedAt = Date.now() - 31 * MINUTE;
        svc.reportActivity('session-tool-less-2', 'working', startedAt, {
            lifecycle: 'turn_started',
            eventType: 'claude/user-prompt-submit',
            turnId: `claude-${startedAt}-bbbb`,
            activityKind: 'task_started'
        });
        const entry = svc.getSessionStatus()['session-tool-less-2'];
        expect(entry, '31min stale claude turn is dropped (dead turn)').toBeUndefined();
    });

    test('story-active-indicator-claude-toolless-staleness ac:3 Codex の codex/hook/ / codex-pty-turn 経路は 5 分 staleness のまま変更しない (非回帰)', () => {
        const svc = makeSvc();
        const startedAt = Date.now() - 6 * MINUTE;
        svc.reportActivity('session-tool-less-3', 'working', startedAt, {
            lifecycle: 'turn_started',
            eventType: 'codex/hook/UserPromptSubmit',
            turnId: `codex-pty-turn-${startedAt}-1234`
        });
        const entry = svc.getSessionStatus()['session-tool-less-3'];
        expect(entry, 'codex keeps 5min staleness — 6min turn is dropped').toBeUndefined();

        // sanity: a recent (1min) codex turn is still working
        const recentSvc = makeSvc();
        const recentAt = Date.now() - 1 * MINUTE;
        recentSvc.reportActivity('session-tool-less-3b', 'working', recentAt, {
            lifecycle: 'turn_started',
            eventType: 'codex/hook/UserPromptSubmit',
            turnId: `codex-pty-turn-${recentAt}-5678`
        });
        const recent = recentSvc.getSessionStatus()['session-tool-less-3b'];
        expect(recent).toBeDefined();
        expect(recent.isWorking).toBe(true);
    });

    test('story-active-indicator-claude-toolless-staleness ac:4 Claude の turn 完了 (done) は working ではなく done のまま、30 分窓を誤適用しない', () => {
        const svc = makeSvc();
        const startedAt = Date.now() - 6 * MINUTE;
        svc.reportActivity('session-tool-less-4', 'working', startedAt, {
            lifecycle: 'turn_started',
            eventType: 'claude/user-prompt-submit',
            turnId: `claude-${startedAt}-dddd`
        });
        svc.reportActivity('session-tool-less-4', 'done', startedAt + 1_000, {
            lifecycle: 'turn_completed',
            eventType: 'turn/completed',
            turnId: `claude-${startedAt}-dddd`
        });
        const entry = svc.getSessionStatus()['session-tool-less-4'];
        expect(entry, 'completed claude turn stays present as done').toBeDefined();
        expect(entry.isWorking, 'done must not be misapplied 30min working window').toBe(false);
        expect(entry.isDone).toBe(true);
    });
});
