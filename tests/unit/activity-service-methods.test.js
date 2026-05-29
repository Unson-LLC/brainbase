import { describe, it, expect, beforeEach } from 'vitest';
import { activityServiceMethods } from '../../server/services/session-core/activity-service-methods.js';

/**
 * activity-service-methods の境界条件テスト
 *
 * 課題#5「セッションリストのActiveインジケーター状態遷移が不安定」 のうち、
 * - lastDoneAt の破壊的リセット (L319, status='working' lifecycle 無し経路)
 * - heartbeat 分岐 (L314 `>=`) と effectiveStatus 計算 (L324 `>`) の不整合
 * を回帰防止する。
 */
describe('activity-service-methods', () => {
    let svc;

    beforeEach(() => {
        svc = {
            hookStatus: new Map(),
            promptBuffers: new Map(),
            sessions: [],
            paneTitleSuppressedSessionIds: new Set(),
            _activityWsBroadcast: null,
            _persistHookStatus: () => Promise.resolve(),
            _persistSessionLiveSummary: () => Promise.resolve(),
            _listTmuxPaneTitles: () => []
        };
        for (const [name, fn] of Object.entries(activityServiceMethods)) {
            svc[name] = fn.bind(svc);
        }
        // bind ループが activityServiceMethods 内の実 _persistHookStatus 等で
        // stub を上書きするため、永続化系は loop の後に no-op で固定する
        // (stateStore 無しの実装が patchSession で落ちる副作用を排除)。
        svc._persistHookStatus = () => Promise.resolve();
        svc._persistSessionLiveSummary = () => Promise.resolve();
        svc._activityWsBroadcast = null;
    });

    describe('reportActivity', () => {
        it('lifecycle無し & status=working_lastDoneAtが破壊的リセットされない', () => {
            // 既存の done 状態を作る
            svc.reportActivity('s1', 'done', 1000);
            const before = svc.hookStatus.get('s1');
            expect(before.lastDoneAt).toBe(1000);

            // lifecycle 無し で status='working' が来る (legacy hook 経路)
            svc.reportActivity('s1', 'working', 2000);
            const after = svc.hookStatus.get('s1');

            // 期待: lastDoneAt は元の値が保持される (memory gotcha「turn_started で前回 done を消すと復元不能」)
            expect(after.lastDoneAt).toBe(1000);
            expect(after.lastWorkingAt).toBe(2000);
        });

        it('turn_started_lastDoneAtを保持する', () => {
            svc.reportActivity('s1', 'done', 1000);
            svc.reportActivity('s1', 'working', 2000, { lifecycle: 'turn_started', turnId: 'turn-1' });
            const status = svc.hookStatus.get('s1');
            expect(status.lastDoneAt).toBe(1000);
            expect(status.lastWorkingAt).toBe(2000);
            expect(status.activeTurnIds).toContain('turn-1');
        });

        it('lastWorkingAt等しいlastDoneAt_effectiveStatusはdone判定', () => {
            // 同時刻に working/done が並ぶ境界
            svc.reportActivity('s1', 'working', 1000);
            svc.reportActivity('s1', 'done', 1000);
            const status = svc.hookStatus.get('s1');
            // L324: activeTurnIds.size === 0 && lastWorkingAt === lastDoneAt なら 'done'
            expect(status.status).toBe('done');
        });

        it('heartbeat_lastWorkingAt等しいlastDoneAt_lastWorkingAtは更新されない', () => {
            // L314 を `>=` から `>` に統一: 同時刻なら done を尊重
            svc.reportActivity('s1', 'working', 1000);
            svc.reportActivity('s1', 'done', 1000);
            const beforeHeartbeat = svc.hookStatus.get('s1');
            expect(beforeHeartbeat.lastWorkingAt).toBe(1000);
            expect(beforeHeartbeat.lastDoneAt).toBe(1000);

            // heartbeat が後から来る
            svc.reportActivity('s1', 'working', 2000, { lifecycle: 'heartbeat' });
            const after = svc.hookStatus.get('s1');

            // 期待: done が支配的なので lastWorkingAt は更新されない
            expect(after.lastWorkingAt).toBe(1000);
            expect(after.status).toBe('done');
        });

        it('heartbeat_lastWorkingAt > lastDoneAt_lastWorkingAtが更新される', () => {
            svc.reportActivity('s1', 'done', 500);
            svc.reportActivity('s1', 'working', 1000);
            const before = svc.hookStatus.get('s1');
            expect(before.lastWorkingAt).toBe(1000);
            expect(before.lastDoneAt).toBe(500);

            svc.reportActivity('s1', 'working', 2000, { lifecycle: 'heartbeat' });
            const after = svc.hookStatus.get('s1');
            expect(after.lastWorkingAt).toBe(2000);
            expect(after.status).toBe('working');
        });

        it('turn_started -> turn_completed_doneに遷移する', () => {
            svc.reportActivity('s1', 'working', 1000, { lifecycle: 'turn_started', turnId: 't1' });
            const working = svc.hookStatus.get('s1');
            expect(working.activeTurnIds).toContain('t1');
            expect(working.status).toBe('working');

            svc.reportActivity('s1', 'done', 2000, { lifecycle: 'turn_completed', turnId: 't1' });
            const done = svc.hookStatus.get('s1');
            expect(done.activeTurnIds).not.toContain('t1');
            expect(done.lastDoneAt).toBe(2000);
            expect(done.status).toBe('done');
        });

        it('claude/post-tool-use_heartbeat_空状態でworkingに復活する', () => {
            // bridge は activeTurnId をローカル state.json で保持し続けて
            // heartbeat だけ投げ続けるケース。server 側で activeTurnIds が
            // 空になっていても claude/post-tool-use heartbeat は強い working
            // signal として扱い、indicator を消さない。
            svc.reportActivity('s1', 'working', 5000, {
                lifecycle: 'heartbeat',
                eventType: 'claude/post-tool-use',
                turnId: 'claude-5000-aaaa',
                activityKind: 'reasoning'
            });
            const after = svc.hookStatus.get('s1');
            expect(after.status).toBe('working');
            expect(after.lastWorkingAt).toBe(5000);
            expect(after.lastEventType).toBe('claude/post-tool-use');
        });

        it('claude_開いたturnは5分heartbeat無しでもindicatorを保つ', () => {
            // Claude の bridge は PostToolUse でしか heartbeat を投げないため、
            // ツール呼び出しを伴わない区間 (深い思考 / 長文生成 / 子エージェント待ち)
            // では 5 分を超えて heartbeat が来ない。5 分の WORKING_TIMEOUT で
            // indicator を消すと作業中なのに消える (= 報告された不具合)。
            const now = Date.now();
            const SIX_MIN = 6 * 60 * 1000;
            svc.reportActivity('s1', 'working', now - SIX_MIN, {
                lifecycle: 'turn_started',
                eventType: 'claude/user-prompt-submit',
                turnId: `claude-${now - SIX_MIN}-aaaa`,
                activityKind: 'task_started'
            });
            const status = svc.getSessionStatus();
            expect(status.s1, '6分heartbeat無しのclaude turnはindicatorを保つ').toBeDefined();
            expect(status.s1.isWorking).toBe(true);
        });

        it('claude_開いたturnは29分(30分窓内)ではまだworkingを保つ_30分境界を固定', () => {
            // 上限境界の固定: pre-fix の 5 分窓ではここで null になる (fix-sensitive)。
            // 31 分で消えるテストと対で 30 分 (CLAUDE_WORKING_TIMEOUT) の値そのものを
            // 検証する。窓を 10 分や 60 分に変えるとこのどちらかが落ちる。
            const now = Date.now();
            const TWENTY_NINE_MIN = 29 * 60 * 1000;
            svc.reportActivity('s1', 'working', now - TWENTY_NINE_MIN, {
                lifecycle: 'turn_started',
                eventType: 'claude/user-prompt-submit',
                turnId: `claude-${now - TWENTY_NINE_MIN}-aaaa`,
                activityKind: 'task_started'
            });
            const status = svc.getSessionStatus();
            expect(status.s1, '29分(30分窓内)の claude turn は working を保つ').toBeDefined();
            expect(status.s1.isWorking).toBe(true);
        });

        it('claude_lastEventTypeがclaude/のみ(turnId無し)でも30分窓が効く_OR分岐を固定', () => {
            // isClaudeWorking の OR 第2分岐 (lastEventType startsWith 'claude/') を
            // 単独で固定する。activeTurnIds に claude- turn が無い heartbeat-only 状態
            // (server 再起動後など) でも 6 分で消えない。
            const now = Date.now();
            const SIX_MIN = 6 * 60 * 1000;
            svc.reportActivity('s1', 'working', now - SIX_MIN, {
                lifecycle: 'heartbeat',
                eventType: 'claude/post-tool-use',
                turnId: `claude-${now - SIX_MIN}-aaaa`,
                activityKind: 'reasoning'
            });
            // server が turn を見失った状況を再現: activeTurnIds を空にする
            const entry = svc.hookStatus.get('s1');
            entry.activeTurnIds = [];
            const status = svc.getSessionStatus();
            expect(status.s1, 'claude/ event のみ(turnId無し)でも 6 分で消えない').toBeDefined();
            expect(status.s1.isWorking).toBe(true);
        });

        it('claude_開いたturnは30分超で死んだとみなしindicatorを消す', () => {
            const now = Date.now();
            const THIRTY_ONE_MIN = 31 * 60 * 1000;
            svc.reportActivity('s1', 'working', now - THIRTY_ONE_MIN, {
                lifecycle: 'turn_started',
                eventType: 'claude/user-prompt-submit',
                turnId: `claude-${now - THIRTY_ONE_MIN}-aaaa`,
                activityKind: 'task_started'
            });
            const status = svc.getSessionStatus();
            // STALE_TURN_TIMEOUT (30分) を過ぎたら turn は死んだとみなす
            expect(status.s1).toBeUndefined();
        });

        it('codex_開いたturnは5分heartbeat無しで消える_非回帰', () => {
            // Codex は codex/hook が密に届き pane-title spinner も効くため、
            // 5 分の WORKING_TIMEOUT を維持する。claude 拡張の巻き込み回帰を防ぐ。
            const now = Date.now();
            const SIX_MIN = 6 * 60 * 1000;
            svc.reportActivity('x1', 'working', now - SIX_MIN, {
                lifecycle: 'turn_started',
                eventType: 'codex/hook/UserPromptSubmit',
                turnId: `codex-pty-turn-${now - SIX_MIN}-1234`
            });
            const status = svc.getSessionStatus();
            expect(status.x1, 'codex の 5分 staleness は据え置き').toBeUndefined();
        });

        it('claude_完了後はworkingではなくdoneのまま_30分窓を誤適用しない', () => {
            const now = Date.now();
            const SIX_MIN = 6 * 60 * 1000;
            svc.reportActivity('s1', 'working', now - SIX_MIN, {
                lifecycle: 'turn_started',
                eventType: 'claude/user-prompt-submit',
                turnId: `claude-${now - SIX_MIN}-aaaa`
            });
            svc.reportActivity('s1', 'done', now - (SIX_MIN - 1000), {
                lifecycle: 'turn_completed',
                eventType: 'turn/completed',
                turnId: `claude-${now - SIX_MIN}-aaaa`
            });
            const status = svc.getSessionStatus();
            expect(status.s1).toBeDefined();
            expect(status.s1.isWorking).toBe(false);
            expect(status.s1.isDone).toBe(true);
        });

        it('claude/_heartbeat_done済みでも復活してindicatorを保つ', () => {
            // 実例: Stop hook で server 側が done 状態に落ちたあと、bridge が
            // bootstrap した turn_started を受け取り損ねたまま heartbeat だけ
            // 届くと indicator が消えていた。Claude prefix の heartbeat を
            // 強い working signal にして復活させる。
            svc.reportActivity('s1', 'done', 1000, {
                lifecycle: 'turn_completed',
                eventType: 'turn/completed',
                turnId: 'claude-900-aaaa'
            });
            const beforeRevival = svc.hookStatus.get('s1');
            expect(beforeRevival.status).toBe('done');

            svc.reportActivity('s1', 'working', 2000, {
                lifecycle: 'heartbeat',
                eventType: 'claude/post-tool-use',
                turnId: 'claude-1500-bbbb',
                activityKind: 'reasoning'
            });
            const after = svc.hookStatus.get('s1');
            expect(after.status).toBe('working');
            expect(after.lastWorkingAt).toBe(2000);
        });
    });
});
