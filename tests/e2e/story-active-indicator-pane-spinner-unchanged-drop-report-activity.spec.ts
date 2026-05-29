import { expect, test } from '@playwright/test';
import { activityServiceMethods } from '../../server/services/session-core/activity-service-methods.js';

/**
 * Story acceptance coverage for story-active-indicator-pane-spinner-unchanged-drop.
 *
 * The tmux pane-title spinner fallback (_getPaneTitleActivityStatuses, surfaced
 * through getSessionStatus and GET /api/sessions/status) used to drop a session
 * whose spinner-prefixed title was unchanged for 30s. Claude's braille spinner
 * (⠂⠐…) advances slowly on the pane title, so a genuinely-working Claude session
 * was false-dropped after 30s -> the list indicator went blue -> 無印 mid-work.
 *
 * The fix raises PANE_TITLE_SPINNER_UNCHANGED_TIMEOUT to 30min (aligned with the
 * explicit CLAUDE_WORKING_TIMEOUT / STALE_TURN_TIMEOUT). A live, observed pane
 * showing a spinner char stays working; only a truly frozen spinner (unchanged
 * 30min) is dropped. Pane-gone / spinner-char-gone still drop immediately.
 *
 * In-process module contract test (Playwright runner as harness, no browser).
 */

const MIN = 60 * 1000;

function makePaneSvc(nowRef: { t: number }, rowsRef: { rows: string[] }) {
    const svc: any = {
        paneTitleActivityCache: new Map(),
        paneTitleSuppressedSessionIds: new Set(),
        hookStatus: new Map(),
        stateStore: { get: () => ({ sessions: [] }) },
        _now: () => nowRef.t,
        _listTmuxPaneTitles: () => rowsRef.rows
    };
    for (const [name, fn] of Object.entries(activityServiceMethods as Record<string, unknown>)) {
        svc[name] = (fn as (...args: unknown[]) => unknown).bind(svc);
    }
    svc._now = () => nowRef.t;
    svc._listTmuxPaneTitles = () => rowsRef.rows;
    return svc;
}

// In-process module-state tests advance a shared injected clock; pin to a single
// worker / serial order so parallel-worker module reuse or warm-up timing cannot
// flake the time-advance assertions.
test.describe.configure({ mode: 'serial' });

test.describe('story-active-indicator-pane-spinner-unchanged-drop e2e contract', () => {
    // Warm the in-process module (import transform + V8 JIT) before any timed
    // assertion so the first test isn't subject to a cold-load race under the
    // Playwright runner. These are deterministic in-process contract tests using
    // an injected clock; the warm-up exercises the full getSessionStatus path once.
    test.beforeAll(() => {
        const warm = makePaneSvc({ t: 1 }, { rows: ['session-warm\t⠂ Claude Code'] });
        warm.getSessionStatus();
    });

    test('story-active-indicator-pane-spinner-unchanged-drop ac:1 Claude の braille スピナーが 30s 以上未変化でも 30 分以内なら getSessionStatus で working を保つ', () => {
        const nowRef = { t: 1_700_000_000_000 };
        const rowsRef = { rows: ['session-1\t⠂ Claude Code'] };
        const svc = makePaneSvc(nowRef, rowsRef);
        expect(svc.getSessionStatus()['session-1']?.isWorking).toBe(true);
        nowRef.t += 10 * MIN; // 10分 未変化
        const e = svc.getSessionStatus()['session-1'];
        expect(e, '10分未変化でも working (pre-fix 30s では消えていた)').toBeDefined();
        expect(e.isWorking).toBe(true);
        expect(e.confidence).toBe('fallback');
    });

    test('story-active-indicator-pane-spinner-unchanged-drop ac:2 真にフリーズした(30 分超未変化)スピナーは getSessionStatus から落とす', () => {
        const nowRef = { t: 1_700_000_000_000 };
        const rowsRef = { rows: ['session-1\t⠂ Claude Code'] };
        const svc = makePaneSvc(nowRef, rowsRef);
        svc.getSessionStatus();
        nowRef.t += 31 * MIN;
        expect(svc.getSessionStatus()['session-1']).toBeUndefined();
    });

    test('story-active-indicator-pane-spinner-unchanged-drop ac:3 スピナー文字が消えたら(idle/done タイトル)即落とす(従来挙動維持)', () => {
        const nowRef = { t: 1_700_000_000_000 };
        const rowsRef = { rows: ['session-1\t⠂ Claude Code'] };
        const svc = makePaneSvc(nowRef, rowsRef);
        expect(svc.getSessionStatus()['session-1'], 'スピナー文字が出ている間は working').toBeDefined();
        nowRef.t += 1 * MIN;
        rowsRef.rows = ['session-1\t✳ Claude Code']; // ✳ は spinner set 外
        expect(svc.getSessionStatus()['session-1'], 'スピナー文字が消えたら(idle/done タイトル)即落とす(従来挙動維持)').toBeUndefined();
    });

    test('story-active-indicator-pane-spinner-unchanged-drop ac:4 braille が進めば(変化すれば)未変化タイマーがリセットされ working を継続する', () => {
        const nowRef = { t: 1_700_000_000_000 };
        const rowsRef = { rows: ['session-1\t⠂ Claude Code'] };
        const svc = makePaneSvc(nowRef, rowsRef);
        svc.getSessionStatus();
        nowRef.t += 20 * MIN;
        rowsRef.rows = ['session-1\t⠴ Claude Code']; // braille 前進 = 変化
        expect(svc.getSessionStatus()['session-1']?.isWorking).toBe(true);
        nowRef.t += 20 * MIN; // 直近変化から 20 分 (累計 40 分) でも working
        expect(svc.getSessionStatus()['session-1']?.isWorking).toBe(true);
    });
});
