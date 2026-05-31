import { describe, it, expect, beforeEach } from 'vitest';
import { activityServiceMethods } from '../../server/services/session-core/activity-service-methods.js';

/**
 * waiting(orange)状態のサーバ契約テスト。
 *
 * Notification hook(claude/notification-waiting)が活動インジケータを orange にするには
 * server の _deriveSnapshotFields が state='waiting' を返す必要がある。条件は
 * isWorking=true かつ activityKind='waiting_input'。status='done' だと isDone が先に効いて
 * done-unread(緑)になるため、hook は status='working' + activityKind='waiting_input' を投げる。
 * その契約を固定する。
 */
describe('waiting (orange) state contract', () => {
    let svc;
    beforeEach(() => {
        svc = {
            hookStatus: new Map(), promptBuffers: new Map(), sessions: [],
            paneTitleSuppressedSessionIds: new Set(),
            _activityWsBroadcast: null,
            _persistHookStatus: () => Promise.resolve(),
            _persistSessionLiveSummary: () => Promise.resolve(),
            _listTmuxPaneTitles: () => []
        };
        for (const [n, f] of Object.entries(activityServiceMethods)) svc[n] = f.bind(svc);
        svc._persistHookStatus = () => Promise.resolve();
        svc._persistSessionLiveSummary = () => Promise.resolve();
        svc._activityWsBroadcast = null;
    });

    it('working + waiting_input(claude/notification-waiting) は state=waiting(orange)になる', () => {
        const t = Date.now();
        svc.reportActivity('s1', 'working', t, { lifecycle: 'turn_started', eventType: 'claude/user-prompt-submit', turnId: `claude-${t}-x`, activityKind: 'task_started' });
        svc.reportActivity('s1', 'working', t + 1000, { lifecycle: 'heartbeat', eventType: 'claude/notification-waiting', turnId: `claude-${t}-x`, activityKind: 'waiting_input', currentStep: 'ユーザー返答待ち' });
        const e = svc.getSessionStatus()['s1'];
        expect(e.state, 'working+waiting_input は orange(waiting)').toBe('waiting');
        expect(e.isWorking).toBe(true);
        expect(e.liveActivity.statusTone).toBe('waiting');
    });

    it('done + waiting_input は done-unread になる(hook が working を使う理由)', () => {
        const t = Date.now();
        svc.reportActivity('s1', 'working', t, { lifecycle: 'turn_started', eventType: 'claude/user-prompt-submit', turnId: `claude-${t}-y` });
        svc.reportActivity('s1', 'done', t + 1000, { lifecycle: 'turn_completed', eventType: 'waiting_for_user_input', turnId: `claude-${t}-y`, activityKind: 'waiting_input' });
        const e = svc.getSessionStatus()['s1'];
        expect(e.state, 'status=done だと isDone が先に効き done-unread(緑)になる').toBe('done-unread');
    });

    it('返答後の PostToolUse heartbeat で waiting → running(青)に戻る', () => {
        const t = Date.now();
        svc.reportActivity('s1', 'working', t, { lifecycle: 'turn_started', eventType: 'claude/user-prompt-submit', turnId: `claude-${t}-z`, activityKind: 'task_started' });
        svc.reportActivity('s1', 'working', t + 1000, { lifecycle: 'heartbeat', eventType: 'claude/notification-waiting', turnId: `claude-${t}-z`, activityKind: 'waiting_input' });
        expect(svc.getSessionStatus()['s1'].state).toBe('waiting');
        svc.reportActivity('s1', 'working', t + 2000, { lifecycle: 'heartbeat', eventType: 'claude/post-tool-use', turnId: `claude-${t}-z`, activityKind: 'reasoning' });
        expect(svc.getSessionStatus()['s1'].state, '返答後は running(青)に戻る').toBe('running');
    });
});
