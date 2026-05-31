import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Story acceptance coverage for story-notification-waiting-indicator.
 *
 * Claude Code の Notification hook(返答待ち)を実バンドルで実行し、稼働インジケータが
 * orange(state=waiting)になることをライブサーバで検証する。純 node コンテキスト。
 */

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../..');
const HOOK_MJS = path.join(repoRoot, '.claude/scripts/hooks/notification/activity-bridge.mjs');
const BASE = process.env.BRAINBASE_BASE_URL || 'http://localhost:31013';

function fireNotification(sid: string, payload: object) {
    return spawnSync('node', [HOOK_MJS], {
        cwd: repoRoot,
        input: JSON.stringify({ session_id: sid, hook_event_name: 'Notification', ...payload }),
        env: { ...process.env, BRAINBASE_SESSION_ID: sid, BRAINBASE_PORT: '31013' },
        encoding: 'utf-8',
        timeout: 10000
    });
}
async function statusOf(sid: string) {
    const map = await (await fetch(`${BASE}/api/sessions/status`)).json() as Record<string, any>;
    return map[sid];
}
const cleanup = (sid: string) => fetch(`${BASE}/api/sessions/${encodeURIComponent(sid)}/clear-done`, {
    method: 'POST', headers: { 'X-Session-Id': sid, 'Content-Type': 'application/json' }, body: '{}'
}).catch(() => {});

test.describe('story-notification-waiting-indicator e2e contract', () => {
    test('story-notification-waiting-indicator ac:1 Notification(permission_prompt) で稼働インジケータが orange(state=waiting)になる', async () => {
        const sid = `session-notif-ac1-${Date.now()}`;
        const res = fireNotification(sid, { notification_type: 'permission_prompt', message: 'Allow Bash?' });
        expect(res.status).toBe(0);
        const e = await statusOf(sid);
        expect(e?.state, 'Notification(permission_prompt) で state=waiting(orange)になる').toBe('waiting');
        expect(e?.isWorking).toBe(true);
        await cleanup(sid);
    });

    test('story-notification-waiting-indicator ac:2 Notification(elicitation_dialog)でも orange(waiting)になる', async () => {
        const sid = `session-notif-ac2-${Date.now()}`;
        fireNotification(sid, { notification_type: 'elicitation_dialog', message: 'Choose an option' });
        const e = await statusOf(sid);
        expect(e?.state, 'Notification(elicitation_dialog)でも orange(waiting)になる').toBe('waiting');
        await cleanup(sid);
    });

    test('story-notification-waiting-indicator ac:3 返答待ちでない通知(idle_prompt/auth_success)では orange を出さない', async () => {
        const sidIdle = `session-notif-ac3a-${Date.now()}`;
        fireNotification(sidIdle, { notification_type: 'idle_prompt', message: 'still there?' });
        expect((await statusOf(sidIdle))?.state, 'idle_prompt では orange(waiting)を出さない').not.toBe('waiting');
        const sidAuth = `session-notif-ac3b-${Date.now()}`;
        fireNotification(sidAuth, { notification_type: 'auth_success', message: 'ok' });
        expect((await statusOf(sidAuth))?.state, 'auth_success では orange(waiting)を出さない').not.toBe('waiting');
    });

    test('story-notification-waiting-indicator ac:4 返答後の活動(report_activity heartbeat)で waiting→running(青)に戻る', async () => {
        const sid = `session-notif-ac4-${Date.now()}`;
        fireNotification(sid, { notification_type: 'permission_prompt', message: 'Allow?' });
        expect((await statusOf(sid))?.state).toBe('waiting');
        // ユーザー返答 → 後続の作業 heartbeat
        const now = Date.now();
        await fetch(`${BASE}/api/sessions/report_activity`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Id': sid },
            body: JSON.stringify({ sessionId: sid, status: 'working', reportedAt: now, lifecycle: 'heartbeat', eventType: 'claude/post-tool-use', turnId: `claude-${now}-r`, activityKind: 'reasoning' })
        });
        const e = await statusOf(sid);
        expect(e?.state, '返答後の活動で waiting→running(青)に戻る').toBe('running');
        await cleanup(sid);
    });
});
