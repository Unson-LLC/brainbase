import { expect, test } from '@playwright/test';
// @ts-ignore - server-side service methods (pure logic, no DOM)
import { activityServiceMethods } from '../../server/services/session-core/activity-service-methods.js';

/**
 * Story acceptance coverage for story-waiting-indicator-sticky-until-response.
 *
 * 入力待ち(orange)を、ユーザーが実際に応答するまで継続させる。背景の pty-shim
 * heartbeat / ready(別セッション切替で resync される)が waiting_input を 'working' で
 * 上書きして orange を即潰す退行を、activity-service-methods の実ロジックで検証する。
 * 純 node コンテキスト、ブラウザ未使用。
 */

function makeSvc() {
    const svc: any = {
        hookStatus: new Map(),
        promptBuffers: new Map(),
        sessions: [],
        paneTitleSuppressedSessionIds: new Set(),
        _activityWsBroadcast: null,
        _persistHookStatus: () => Promise.resolve(),
        _persistSessionLiveSummary: () => Promise.resolve(),
        _listTmuxPaneTitles: () => []
    };
    for (const [name, fn] of Object.entries(activityServiceMethods)) svc[name] = (fn as any).bind(svc);
    svc._persistHookStatus = () => Promise.resolve();
    svc._persistSessionLiveSummary = () => Promise.resolve();
    svc._activityWsBroadcast = null;
    return svc;
}

// staleness は実 Date.now() を使うため直近時刻を基準にする(全イベントは数百ms以内)。
const T = Date.now();
const stateOf = (svc: any) => svc.getSessionStatus()['s1']?.state;
function enterWaiting(svc: any) {
    svc.reportActivity('s1', 'working', T, { lifecycle: 'turn_started', turnId: 'turn-1' });
    svc.reportActivity('s1', 'working', T + 100, { lifecycle: 'heartbeat', eventType: 'waiting_for_user_input', activityKind: 'waiting_input' });
}

test.describe('story-waiting-indicator-sticky-until-response e2e contract', () => {
    test('story-waiting-indicator-sticky-until-response ac:1 入力待ち(waiting/orange)は背景イベント(pty-shim heartbeat/ready)では解除されず継続する', () => {
        const svc = makeSvc();
        enterWaiting(svc);
        expect(stateOf(svc), '待機に入る').toBe('waiting');
        svc.reportActivity('s1', 'working', T + 200, { lifecycle: 'heartbeat', eventType: 'codex/pty-shim-heartbeat' });
        svc.reportActivity('s1', 'working', T + 300, { lifecycle: 'heartbeat', eventType: 'codex/pty-shim-ready' });
        expect(stateOf(svc), '入力待ち(waiting/orange)は背景イベント(pty-shim heartbeat/ready)では解除されず継続する').toBe('waiting');
    });

    test('story-waiting-indicator-sticky-until-response ac:2 ユーザーが応答して実活動イベントが届いたら waiting を解除する', () => {
        const svc = makeSvc();
        enterWaiting(svc);
        svc.reportActivity('s1', 'working', T + 400, { lifecycle: 'heartbeat', eventType: 'exec_command_output_delta' });
        expect(stateOf(svc), 'ユーザーが応答して実活動イベントが届いたら waiting を解除する').toBe('running');
    });

    test('story-waiting-indicator-sticky-until-response ac:3 turn が完了したら waiting を解除して done へ遷移する', () => {
        const svc = makeSvc();
        enterWaiting(svc);
        svc.reportActivity('s1', 'done', T + 500, { lifecycle: 'turn_completed', turnId: 'turn-1' });
        expect(stateOf(svc), 'turn が完了したら waiting を解除して done へ遷移する').toBe('done-unread');
    });

    test('story-waiting-indicator-sticky-until-response ac:4 明示 activityKind を伴う実フックイベントは waiting を上書きできる', () => {
        const svc = makeSvc();
        enterWaiting(svc);
        svc.reportActivity('s1', 'working', T + 250, { lifecycle: 'heartbeat', eventType: 'claude/post-tool-use', activityKind: 'editing_file' });
        expect(stateOf(svc), '明示 activityKind を伴う実フックイベントは waiting を上書きできる').toBe('running');
    });
});
