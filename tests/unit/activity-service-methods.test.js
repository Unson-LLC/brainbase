import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
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

    describe('_getPaneTitleActivityStatuses (pane-title spinner fallback)', () => {
        let paneSvc;
        let nowRef;
        let paneRows;

        // Prime the module (import transform + V8 JIT of _getPaneTitleActivityStatuses)
        // once before the timed assertions so the first test isn't subject to a
        // cold-load race. Uses an isolated throwaway svc; touches no shared state.
        beforeAll(() => {
            const warm = {
                paneTitleActivityCache: new Map(),
                paneTitleSuppressedSessionIds: new Set(),
                hookStatus: new Map(),
                stateStore: { get: () => ({ sessions: [] }) },
                _now: () => 1,
                _listTmuxPaneTitles: () => ['session-warm\t⠂ Claude Code']
            };
            for (const [name, fn] of Object.entries(activityServiceMethods)) {
                warm[name] = fn.bind(warm);
            }
            warm._now = () => 1;
            warm._listTmuxPaneTitles = () => ['session-warm\t⠂ Claude Code'];
            warm._getPaneTitleActivityStatuses();
        });

        beforeEach(() => {
            nowRef = { t: 1_000_000_000_000 };
            paneRows = [];
            paneSvc = {
                paneTitleActivityCache: new Map(),
                paneTitleSuppressedSessionIds: new Set(),
                hookStatus: new Map(),
                stateStore: { get: () => ({ sessions: [] }) },
                _now: () => nowRef.t,
                _listTmuxPaneTitles: () => paneRows
            };
            for (const [name, fn] of Object.entries(activityServiceMethods)) {
                paneSvc[name] = fn.bind(paneSvc);
            }
            paneSvc._now = () => nowRef.t;
            paneSvc._listTmuxPaneTitles = () => paneRows;
        });

        const MIN = 60 * 1000;

        it('claude_braille文字が30s以上未変化でも30分以内ならworkingを保つ_誤ドロップ防止', () => {
            // Claude の braille スピナーは pane title 上でゆっくりしか進まない。
            // 同一タイトルが続いても 30 分以内なら working。pre-fix(30s) では消えていた。
            paneRows = ['session-1\t⠂ Claude Code'];
            expect(paneSvc._getPaneTitleActivityStatuses()['session-1']?.isWorking).toBe(true);

            // 5 分後、タイトル未変化（braille が進んでいない）でも working を保つ
            nowRef.t += 5 * MIN;
            const s = paneSvc._getPaneTitleActivityStatuses()['session-1'];
            expect(s, '5分未変化でも working を保つ (旧30sでは消えていた)').toBeDefined();
            expect(s.isWorking).toBe(true);
            expect(s.confidence).toBe('fallback');
        });

        it('claude_braille文字が30分超で未変化ならフリーズとみなし落とす', () => {
            paneRows = ['session-1\t⠂ Claude Code'];
            paneSvc._getPaneTitleActivityStatuses(); // first seen
            nowRef.t += 31 * MIN; // 未変化のまま 31 分
            expect(paneSvc._getPaneTitleActivityStatuses()['session-1']).toBeUndefined();
        });

        it('braille文字が進めば(変化すれば)タイマーがリセットされ長時間workingを保つ', () => {
            paneRows = ['session-1\t⠂ Claude Code'];
            paneSvc._getPaneTitleActivityStatuses();
            nowRef.t += 20 * MIN;
            paneRows = ['session-1\t⠴ Claude Code']; // braille が進んだ = 変化
            expect(paneSvc._getPaneTitleActivityStatuses()['session-1']?.isWorking).toBe(true);
            nowRef.t += 20 * MIN; // 変化から 20 分（合計 40 分だが直近変化から 20 分）
            expect(paneSvc._getPaneTitleActivityStatuses()['session-1']?.isWorking).toBe(true);
        });

        it('スピナー文字が消えた(idle/done タイトル)ら即落とす', () => {
            paneRows = ['session-1\t⠂ Claude Code'];
            expect(paneSvc._getPaneTitleActivityStatuses()['session-1']).toBeDefined();
            nowRef.t += 1 * MIN;
            paneRows = ['session-1\t✳ Claude Code']; // ✳ は spinner set 外 = idle/waiting
            expect(paneSvc._getPaneTitleActivityStatuses()['session-1']).toBeUndefined();
        });

        it('pane が見えなくなったら STALE_TIMEOUT(30s) で落とす', () => {
            paneRows = ['session-1\t⠂ Claude Code'];
            expect(paneSvc._getPaneTitleActivityStatuses()['session-1']).toBeDefined();
            nowRef.t += 31 * 1000; // 31s
            paneRows = []; // pane が一覧から消えた
            expect(paneSvc._getPaneTitleActivityStatuses()['session-1']).toBeUndefined();
        });
    });

    // 入力待ち(orange)が、ユーザーが実際に応答するまで継続すること。
    // 背景の pty-shim heartbeat / ready(別セッション切替で resync される)が
    // waiting_input を 'working' で上書きして orange を即潰す退行の回帰防止。
    describe('waiting(orange) のスティッキー維持', () => {
        // _buildStatusForSession の staleness は実 Date.now() を使うため、直近の時刻を基準にする
        // (全イベントは数百ms以内で 5 分の working timeout に収まる)。
        const T = Date.now();
        let wsvc;
        beforeEach(() => {
            wsvc = {
                hookStatus: new Map(),
                promptBuffers: new Map(),
                sessions: [],
                paneTitleSuppressedSessionIds: new Set(),
                _activityWsBroadcast: null,
                _persistHookStatus: () => Promise.resolve(),
                _persistSessionLiveSummary: () => Promise.resolve(),
                _listTmuxPaneTitles: () => [],
                _now: () => T + 600
            };
            for (const [name, fn] of Object.entries(activityServiceMethods)) wsvc[name] = fn.bind(wsvc);
            wsvc._persistHookStatus = () => Promise.resolve();
            wsvc._persistSessionLiveSummary = () => Promise.resolve();
            wsvc._activityWsBroadcast = null;
        });
        const state = () => wsvc.getSessionStatus()['s1']?.state;
        const enterWaiting = () => {
            wsvc.reportActivity('s1', 'working', T, { lifecycle: 'turn_started', turnId: 'turn-1' });
            wsvc.reportActivity('s1', 'working', T + 100, { lifecycle: 'heartbeat', eventType: 'waiting_for_user_input', activityKind: 'waiting_input' });
        };

        it('入力待ちは pty-shim heartbeat 背景イベントでも維持される(orange のまま)', () => {
            enterWaiting();
            expect(state(), '待機に入る').toBe('waiting');
            wsvc.reportActivity('s1', 'working', T + 200, { lifecycle: 'heartbeat', eventType: 'codex/pty-shim-heartbeat' });
            expect(state(), 'pty-shim heartbeat では waiting を維持').toBe('waiting');
        });

        it('入力待ちは pty-shim ready(別セッション切替の resync)でも維持される', () => {
            enterWaiting();
            wsvc.reportActivity('s1', 'working', T + 300, { lifecycle: 'heartbeat', eventType: 'codex/pty-shim-ready' });
            expect(state(), 'pty-shim ready では waiting を維持').toBe('waiting');
        });

        it('ユーザーが応答して実活動イベントが来たら waiting を解除する', () => {
            enterWaiting();
            wsvc.reportActivity('s1', 'working', T + 400, { lifecycle: 'heartbeat', eventType: 'exec_command_output_delta' });
            expect(state(), '実活動(コマンド出力)では running へ解除').toBe('running');
        });

        it('turn 完了したら waiting を解除して done へ遷移する', () => {
            enterWaiting();
            wsvc.reportActivity('s1', 'done', T + 500, { lifecycle: 'turn_completed', turnId: 'turn-1' });
            expect(state(), 'turn 完了で done-unread へ').toBe('done-unread');
        });

        it('明示 activityKind を伴う実フックイベントは waiting を上書きできる', () => {
            enterWaiting();
            wsvc.reportActivity('s1', 'working', T + 250, { lifecycle: 'heartbeat', eventType: 'claude/post-tool-use', activityKind: 'editing_file' });
            expect(state(), '明示 activityKind は待機を解除').toBe('running');
        });

        it('_shouldPreserveWaiting: 背景イベントのみ維持・実イベント/turn無し/doneは維持しない', () => {
            const prev = { activityKind: 'waiting_input', statusTone: 'waiting' };
            const turns = new Set(['turn-1']);
            // 維持する: 背景ノイズ + turn 開いている + status working
            expect(wsvc._shouldPreserveWaiting({ previous: prev, eventType: 'codex/pty-shim-heartbeat', status: 'working', activeTurnIds: turns })).toBe(true);
            expect(wsvc._shouldPreserveWaiting({ previous: prev, eventType: '', status: 'working', activeTurnIds: turns })).toBe(true);
            // 維持しない: turn 終了(done)
            expect(wsvc._shouldPreserveWaiting({ previous: prev, eventType: 'codex/pty-shim-heartbeat', status: 'done', activeTurnIds: turns })).toBe(false);
            // 維持しない: active turn 無し
            expect(wsvc._shouldPreserveWaiting({ previous: prev, eventType: 'codex/pty-shim-heartbeat', status: 'working', activeTurnIds: new Set() })).toBe(false);
            // 維持しない: 実フックイベント(背景セット外)
            expect(wsvc._shouldPreserveWaiting({ previous: prev, eventType: 'exec_command_output_delta', status: 'working', activeTurnIds: turns })).toBe(false);
            // 維持しない: 直前が waiting でない
            expect(wsvc._shouldPreserveWaiting({ previous: { activityKind: 'reasoning' }, eventType: 'codex/pty-shim-heartbeat', status: 'working', activeTurnIds: turns })).toBe(false);
        });
    });
});
