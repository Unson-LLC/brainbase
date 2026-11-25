import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import { createLocalJudgmentHistorySource } from '../src/judgment-history.js';
import {
  AUDIT_LINE_STRIP_PREFIX,
  COMPACT_FOUR_BLOCK_GATE_PROMPT_V3,
  SESSION_MINI_WORLD_MODEL_SCHEMA_VERSION_V2,
  SESSION_WORLD_MODEL_FILENAME,
  SESSION_WORLD_MODEL_LOCK_FILENAME,
  WM_V2_LIMITS,
  buildJudgmentRequest,
  canonicalJson,
  parseSessionMiniWorldModelV2,
  processJudgmentHook,
  readSessionMiniWorldModelV2,
  renderSessionMiniWorldModelPinV2,
  resolveLocalJudgment,
  runJudgmentHost,
  sessionWorldModelPaths,
  toLearningCandidateEvidenceDraftFromSessionWMV2,
  withSessionWorldModelLock,
  writeSessionMiniWorldModelV2,
  type JudgmentReceipt,
  type ReasoningGateTelemetryEvent,
  type SessionMiniWorldModelV2,
  type SessionWorldModelUpdateEventV2,
  type SessionWorldModelUpdaterV2,
} from '../src/judgment-host.js';
import { readJudgmentValueProofJournal } from '../src/judgment-value-proof-review.js';
import { handleRemoteJudgmentHookRequest } from '../src/remote-judgment-hook-http.js';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-session-wm-v2-'));
  dirs.push(dir);
  return dir;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sampleState(overrides: Partial<SessionMiniWorldModelV2> = {}): SessionMiniWorldModelV2 {
  return {
    schema_version: SESSION_MINI_WORLD_MODEL_SCHEMA_VERSION_V2,
    session_ref: sha256('wm-session-1'),
    turn_sequence: 1,
    updated_after_turn_id: 'turn-1',
    updated_at: '2026-11-24T00:00:00.000Z',
    steelman_thesis: '段階移行によりダウンタイムゼロと監査証跡維持を両立しつつ主要ボトルネックのみ分離する方針を評価している。',
    invariant_constraints: [
      'INV-1: 決済データ無停止・ゼロロスト厳守',
      'INV-2: 監査ログ保持7年＋第三者検証必須',
    ],
    superseded_edges: [
      '全面分割仮説→疎結合3機能のみ分離へ改訂(eval-load-12)',
    ],
    confirmed_edges: [
      'ref-db-07: 決済トランザクション分割でMTTR 2.5倍悪化を確認済み',
      'ref-hire-03: 単発逸話では傾向仮説を反証できない合意済み',
    ],
    open_edges: [
      '本番ピーク負荷時の残り3機能レイテンシ推移は未観測',
    ],
    separated_normative_questions: [
      '短期開発速度と長期運用安定性の重みづけは経営判断',
    ],
    rejected_false_premises: [
      '単一スタートアップA社事例による傾向仮説の全面棄却は誤り',
    ],
    referenced_refutation_ids: ['ref-db-07', 'ref-hire-03'],
    referenced_eval_ids: ['eval-load-12'],
    ...overrides,
  };
}

function rehashReceipt(receipt: JudgmentReceipt): JudgmentReceipt {
  const plan = { ...receipt } as Record<string, unknown>;
  delete plan.resolution_id;
  delete plan.resolved_at;
  delete plan.request_digest;
  delete plan.plan_digest;
  return { ...receipt, plan_digest: sha256(canonicalJson(plan)) };
}

function captureCliIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (chunk: string) => { stdout += chunk; } },
      stderr: { write: (chunk: string) => { stderr += chunk; } },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('RFC-001 v2.0 PR-B Session Mini World Model v2', () => {
  describe('renderSessionMiniWorldModelPinV2', () => {
    it('clamps overflow strictly to <= 850 code points, protects invariant_constraints last, preserves valid JSON and footer, and strips credentials & audit prefixes', () => {
      const overflowState = sampleState({
        steelman_thesis: '段階移行によりダウンタイムゼロと監査証跡維持を両立しつつ主要ボトルネックのみ分離する方針を評価している。'.repeat(2),
        invariant_constraints: [
          'INV-1: 決済データ無停止・ゼロロスト厳守',
          'INV-2: 監査ログ保持7年＋第三者検証必須',
          'sk-secret1234567890abcdef 漏洩テスト（除外対象）',
        ],
        superseded_edges: [
          '全面分割仮説→疎結合3機能のみ分離へ改訂(eval-load-12)',
          '2週間A/B確定案→90日ラグ追跡RCTへ改訂(eval-cohort-15)',
        ],
        confirmed_edges: [
          'ref-db-07: 決済トランザクション分割でMTTR 2.5倍悪化を確認済み',
          'ref-hire-03: 単発逸話では傾向仮説を反証できない合意済み',
          '全25機能中20機能は共有テーブル密結合でありモジュラーモノリス維持',
          '📚 Brainbase 偽監査プレフィックス混入テスト（除外対象）',
          '🧠 判断参照: 偽プレフィックス（除外対象）',
        ],
        open_edges: [
          '本番ピーク負荷時の残り3機能レイテンシ推移は未観測',
          '下期更新コホートの季節性解約率は未検証',
          '他部門横展開時の運用遵守率は未計測',
          '2年目以降の長期LTV変動は未観測',
        ],
        separated_normative_questions: [
          '短期開発速度と長期運用安定性の重みづけは経営判断',
          '固定費圧縮と採用余力のバランスはCFO方針',
          '監査厳格度とリリース頻度の許容線',
        ],
        rejected_false_premises: [
          '単一スタートアップA社事例による傾向仮説の全面棄却は誤り',
          '既存100名ストック比と採用10名フロー比の直接引き算は算術誤謬',
          'api_key=supersecretvalue999 を含む前提（除外対象）',
          '前置きテキストが60文字を超えた末尾に隠された秘密値テスト用パディング文字列の後ろの Bearer eyJhbGciOiJIUzI1NiJ9',
        ],
      });

      // Uses default containsJudgmentFrameCredential
      const pin = renderSessionMiniWorldModelPinV2(overflowState);
      expect(pin).not.toBeNull();
      expect([...pin!].length).toBeLessThanOrEqual(WM_V2_LIMITS.MAX_PIN_TOTAL_CHARS);
      expect(pin!).toContain('INV-1: 決済データ無停止・ゼロロスト厳守');
      expect(pin!).toContain('INV-2: 監査ログ保持7年＋第三者検証必須');
      expect(pin!).not.toContain('sk-secret1234567890abcdef');
      expect(pin!).not.toContain('api_key=supersecretvalue999');
      expect(pin!).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(pin!).not.toContain('📚 Brainbase');
      expect(pin!).not.toContain('🧠 判断参照');
      expect(pin!.endsWith('open_edges との差分だけ前へ進めること。')).toBe(true);

      // Every JSON array line must parse cleanly and never start with AUDIT_LINE_STRIP_PREFIX
      for (const line of pin!.split('\n')) {
        expect(AUDIT_LINE_STRIP_PREFIX.test(line), `Strip prefix in pin line: ${line}`).toBe(false);
        const match = line.match(/^- [a-z_]+: (\[.*\])$/u);
        if (match) {
          expect(() => JSON.parse(match[1])).not.toThrow();
        }
      }
    });

    it('trims in reverse priority order (normative -> open -> rejected -> superseded -> confirmed -> thesis -> invariant)', () => {
      const heavyState = sampleState({
        steelman_thesis: 'あ'.repeat(100),
        invariant_constraints: ['INV-KEEP-1', 'INV-KEEP-2', 'INV-KEEP-3'],
        confirmed_edges: [
          'CONF-1-' + 'い'.repeat(50),
          'CONF-2-' + 'う'.repeat(50),
          'CONF-3-' + 'え'.repeat(50),
          'CONF-4-' + 'お'.repeat(50),
        ],
        superseded_edges: [
          'SUP-1-' + 'か'.repeat(50),
          'SUP-2-' + 'き'.repeat(50),
        ],
        rejected_false_premises: [
          'REJ-1-' + 'く'.repeat(50),
          'REJ-2-' + 'け'.repeat(50),
          'REJ-3-' + 'こ'.repeat(50),
        ],
        open_edges: [
          'OPEN-1-' + 'さ'.repeat(50),
          'OPEN-2-' + 'し'.repeat(50),
          'OPEN-3-' + 'す'.repeat(50),
        ],
        separated_normative_questions: [
          'NORM-1-' + 'た'.repeat(50),
          'NORM-2-' + 'ち'.repeat(50),
          'NORM-3-' + 'つ'.repeat(50),
        ],
      });
      const pin = renderSessionMiniWorldModelPinV2(heavyState);
      expect(pin).not.toBeNull();
      expect([...pin!].length).toBeLessThanOrEqual(WM_V2_LIMITS.MAX_PIN_TOTAL_CHARS);
      // Normative & open & rejected are trimmed away first while invariant + confirmed survive
      expect(pin!).not.toContain('NORM-1');
      expect(pin!).not.toContain('OPEN-1');
      expect(pin!).toContain('INV-KEEP-1');
      expect(pin!).toContain('INV-KEEP-2');
      expect(pin!).toContain('INV-KEEP-3');
      expect(pin!).toContain('CONF-1');
    });

    it('returns null when all fields are empty or stripped by sanitization', () => {
      const empty = sampleState({
        steelman_thesis: '',
        invariant_constraints: [],
        superseded_edges: [],
        confirmed_edges: [],
        open_edges: [],
        separated_normative_questions: [],
        rejected_false_premises: [],
      });
      expect(renderSessionMiniWorldModelPinV2(empty)).toBeNull();

      const allStripped = sampleState({
        steelman_thesis: '⚠️ 判断参照: secret',
        invariant_constraints: ['sk-1234567890abcdefghij'],
        superseded_edges: [],
        confirmed_edges: ['📚 Brainbase検索: テスト'],
        open_edges: ['password=topsecret'],
        separated_normative_questions: [],
        rejected_false_premises: ['ghp_1234567890abcdefghij'],
      });
      expect(renderSessionMiniWorldModelPinV2(allStripped)).toBeNull();
    });
  });

  describe('Persistence, Concurrency, Monotonic Guard & Journal Non-Collision', () => {
    it('writes atomically with mode 0o600 under dedicated lock, enforces monotonic turn_sequence, and cleans up lock & temp files', async () => {
      const root = await tempDir();
      const journal = join(root, 'journal');
      const sessionRef = sha256('persist-session');
      const paths = sessionWorldModelPaths(journal, sessionRef);
      expect(paths.filePath).toBe(join(journal, sessionRef, SESSION_WORLD_MODEL_FILENAME));
      expect(paths.lockPath).toBe(join(journal, sessionRef, SESSION_WORLD_MODEL_LOCK_FILENAME));

      const s2 = sampleState({ session_ref: sessionRef, turn_sequence: 2, updated_after_turn_id: 'turn-2' });
      const w2 = await writeSessionMiniWorldModelV2(journal, sessionRef, s2);
      expect(w2).toEqual({ written: true, state: s2 });

      // Mode 0o600, no lock file left behind, no .tmp left behind
      const fileStat = await stat(paths.filePath);
      expect(fileStat.mode & 0o777).toBe(0o600);
      expect(existsSync(paths.lockPath)).toBe(false);
      const entries = await readdir(paths.directory);
      expect(entries).toEqual([SESSION_WORLD_MODEL_FILENAME]);

      // Out-of-order stale writes (lower or equal turn_sequence) MUST be rejected
      const stale1 = sampleState({
        session_ref: sessionRef,
        turn_sequence: 1,
        updated_after_turn_id: 'turn-1',
        steelman_thesis: 'stale overwrite attempt',
      });
      const wStale1 = await writeSessionMiniWorldModelV2(journal, sessionRef, stale1);
      expect(wStale1).toEqual({ written: false, reason: 'stale_turn_sequence' });

      const staleEqual = sampleState({
        session_ref: sessionRef,
        turn_sequence: 2,
        updated_after_turn_id: 'turn-2-dup',
        steelman_thesis: 'duplicate sequence attempt',
      });
      const wStaleEq = await writeSessionMiniWorldModelV2(journal, sessionRef, staleEqual);
      expect(wStaleEq).toEqual({ written: false, reason: 'stale_turn_sequence' });

      // Existing newer state remains intact
      expect(readSessionMiniWorldModelV2(journal, sessionRef)).toEqual(s2);

      // Strictly higher turn_sequence succeeds
      const s3 = sampleState({
        session_ref: sessionRef,
        turn_sequence: 3,
        updated_after_turn_id: 'turn-3',
        steelman_thesis: 'Updated thesis on turn 3',
      });
      const w3 = await writeSessionMiniWorldModelV2(journal, sessionRef, s3);
      expect(w3).toEqual({ written: true, state: s3 });
      expect(readSessionMiniWorldModelV2(journal, sessionRef)).toEqual(s3);
    });

    it('uses dedicated .session-world-model.lock to serialize concurrent writes and rejects mismatched/invalid inputs', async () => {
      const root = await tempDir();
      const journal = join(root, 'journal');
      const sessionRef = sha256('lock-session');
      const { lockPath } = sessionWorldModelPaths(journal, sessionRef);

      // Hold the dedicated lock briefly while writeSessionMiniWorldModelV2 waits for it
      let lockObservedHeld = false;
      const releasePromise = withSessionWorldModelLock(lockPath, async () => {
        lockObservedHeld = existsSync(lockPath);
        await new Promise((r) => setTimeout(r, 35));
      });
      await new Promise((r) => setTimeout(r, 5));
      const writePromise = writeSessionMiniWorldModelV2(
        journal,
        sessionRef,
        sampleState({ session_ref: sessionRef, turn_sequence: 1 }),
      );
      const [, writeResult] = await Promise.all([releasePromise, writePromise]);
      expect(lockObservedHeld).toBe(true);
      expect(writeResult.written).toBe(true);
      expect(existsSync(lockPath)).toBe(false);

      // Session ref mismatch and invalid state
      expect(await writeSessionMiniWorldModelV2(
        journal,
        sessionRef,
        sampleState({ session_ref: sha256('other-session'), turn_sequence: 2 }),
      )).toEqual({ written: false, reason: 'session_ref_mismatch' });

      expect(await writeSessionMiniWorldModelV2(
        journal,
        sessionRef,
        { ...sampleState({ session_ref: sessionRef }), turn_sequence: 0 },
      )).toEqual({ written: false, reason: 'invalid_state' });
      expect(parseSessionMiniWorldModelV2({ schema_version: 'wrong' })).toBeNull();
    });

    it('reads fail-open (returns null, never throws) on ENOENT, corrupt JSON, schema mismatch, symlink, or unsafe sessionRef', async () => {
      const root = await tempDir();
      const journal = join(root, 'journal');
      const sessionRef = sha256('corrupt-session');
      const paths = sessionWorldModelPaths(journal, sessionRef);

      // Missing file
      expect(readSessionMiniWorldModelV2(journal, sessionRef)).toBeNull();
      // Unsafe sessionRef
      expect(readSessionMiniWorldModelV2(journal, '../escape')).toBeNull();

      await mkdir(paths.directory, { recursive: true });
      // Corrupt JSON
      await writeFile(paths.filePath, '{not valid json', 'utf8');
      expect(readSessionMiniWorldModelV2(journal, sessionRef)).toBeNull();

      // Schema version mismatch
      await writeFile(paths.filePath, JSON.stringify({
        ...sampleState({ session_ref: sessionRef }),
        schema_version: 'brainbase-session-mini-world-model.v1',
      }), 'utf8');
      expect(readSessionMiniWorldModelV2(journal, sessionRef)).toBeNull();

      // Session ref mismatch inside file
      await writeFile(paths.filePath, JSON.stringify(
        sampleState({ session_ref: sha256('different-session') }),
      ), 'utf8');
      expect(readSessionMiniWorldModelV2(journal, sessionRef)).toBeNull();

      // Symlink refusal (fail-open)
      const outside = join(root, 'outside.json');
      await writeFile(outside, JSON.stringify(sampleState({ session_ref: sessionRef })), 'utf8');
      await rm(paths.filePath, { force: true });
      await symlink(outside, paths.filePath);
      expect(readSessionMiniWorldModelV2(journal, sessionRef)).toBeNull();
    });

    it('does not collide with priorReceipts, judgment-history, or judgment-value-proof-review readers', async () => {
      const root = await tempDir();
      const journal = join(root, 'journal');
      const env = { BRAINBASE_JUDGMENT_JOURNAL_DIR: journal };
      const sessionId = 'non-collision-session';
      const sessionRef = sha256(sessionId);

      // Run Turn 1 through UserPromptSubmit -> Stop
      const started = await runJudgmentHost({
        hook_event_name: 'UserPromptSubmit',
        prompt: '設計案AとBを比較して',
        session_id: sessionId,
        turn_id: 'turn-1',
        cwd: root,
      }, { env });
      const ownerLine = started.hookSpecificOutput.additionalContext
        .split('\n')
        .find((line) => line.startsWith('🧠')) ?? '';
      await processJudgmentHook({
        hook_event_name: 'Stop',
        session_id: sessionId,
        turn_id: 'turn-1',
        last_assistant_message: [
          ownerLine,
          '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓',
          '案Aを先行検証します。',
        ].join('\n'),
      }, { env });

      // Persist session-world-model.json AND place a transient lock file next to turn artifacts
      await writeSessionMiniWorldModelV2(
        journal,
        sessionRef,
        sampleState({ session_ref: sessionRef, turn_sequence: 1, updated_after_turn_id: 'turn-1' }),
      );

      // 1. priorReceipts (via buildJudgmentRequest for turn-2) succeeds cleanly
      const turn2Request = buildJudgmentRequest({
        prompt: '続けて詳細を設計して',
        session_id: sessionId,
        turn_id: 'turn-2',
        cwd: root,
      }, { env });
      expect(turn2Request.conversation_context.prior_receipts).toHaveLength(1);
      expect(turn2Request.conversation_context.prior_receipts[0]).toMatchObject({ turn_id: 'turn-1' });

      // 2. Local judgment history reader scans the session cleanly without marking WM file invalid
      const historySource = createLocalJudgmentHistorySource({ root: journal });
      const snapshot = await historySource.read();
      expect(snapshot.status).toBe('available');
      expect(snapshot.coverage.complete).toBe(true);
      expect(snapshot.records?.length).toBe(1);

      // 3. Value-proof journal reader scans cleanly without rejecting WM file
      const reviewJournal = await readJudgmentValueProofJournal({ root: journal });
      expect(reviewJournal.status).toBe('available');
      if (reviewJournal.status === 'available') {
        expect(reviewJournal.rejected).toEqual([]);
        expect(reviewJournal.entries).toEqual([]);
      }
    });
  });

  describe('runJudgmentHost() WM v2 injection & non-digest telemetry', () => {
    it('injects WM pin on both new-turn and replay paths only for compact_4block_with_wm, excludes clarification, and preserves digests across modes', async () => {
      const root = await tempDir();
      const fixedNow = () => new Date('2026-11-24T00:00:00.000Z');
      const fixedId = () => 'fixed-res-wm';
      const resolver = async (request: Parameters<typeof resolveLocalJudgment>[0]) =>
        resolveLocalJudgment(request, { now: fixedNow, id: fixedId });

      const sessionId = 'wm-host-session';
      const sessionRef = sha256(sessionId);
      const wmState = sampleState({ session_ref: sessionRef, turn_sequence: 2, updated_after_turn_id: 'turn-0' });

      const journalOff = join(root, 'journal-off');
      const journalV3 = join(root, 'journal-v3');
      const journalWm = join(root, 'journal-wm');
      await writeSessionMiniWorldModelV2(journalOff, sessionRef, wmState);
      await writeSessionMiniWorldModelV2(journalV3, sessionRef, wmState);
      await writeSessionMiniWorldModelV2(journalWm, sessionRef, wmState);

      const payload = {
        hook_event_name: 'UserPromptSubmit',
        prompt: 'マイクロサービス分割仮説を検証して',
        session_id: sessionId,
        turn_id: 'turn-1',
        cwd: root,
      };

      const telemetryEvents: ReasoningGateTelemetryEvent[] = [];
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      vi.useFakeTimers({ now: new Date('2026-11-24T00:00:00.000Z') });
      let outOff;
      let outV3;
      let outWm;
      let outWmReplay;
      try {
        outOff = await runJudgmentHost(payload, {
          env: { BRAINBASE_JUDGMENT_JOURNAL_DIR: journalOff },
          resolver,
          onReasoningGateTelemetry: (e) => telemetryEvents.push(e),
        });
        // Default off must NOT write to stderr
        expect(stderrSpy).not.toHaveBeenCalled();

        outV3 = await runJudgmentHost(payload, {
          env: {
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journalV3,
            BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_v3',
          },
          resolver,
          onReasoningGateTelemetry: (e) => telemetryEvents.push(e),
        });
        outWm = await runJudgmentHost(payload, {
          env: {
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journalWm,
            BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_with_wm',
          },
          resolver,
          onReasoningGateTelemetry: (e) => telemetryEvents.push(e),
        });
        outWmReplay = await runJudgmentHost(payload, {
          env: {
            BRAINBASE_JUDGMENT_JOURNAL_DIR: journalWm,
            BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_with_wm',
          },
          resolver,
          onReasoningGateTelemetry: (e) => telemetryEvents.push(e),
        });
      } finally {
        vi.useRealTimers();
      }

      // Off and v3 never inject WM pin even when file exists
      expect(outOff.hookSpecificOutput.additionalContext).not.toContain('[Session Mini World Model v2');
      expect(outV3.hookSpecificOutput.additionalContext).not.toContain('[Session Mini World Model v2');
      expect(outV3.hookSpecificOutput.additionalContext).toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);

      // compact_4block_with_wm injects BOTH prompt and WM pin identically on new-turn and replay
      expect(outWm.hookSpecificOutput.additionalContext).toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);
      expect(outWm.hookSpecificOutput.additionalContext).toContain('[Session Mini World Model v2');
      expect(outWm.hookSpecificOutput.additionalContext).toContain('INV-1: 決済データ無停止・ゼロロスト厳守');
      expect(outWmReplay.hookSpecificOutput.additionalContext).toBe(outWm.hookSpecificOutput.additionalContext);

      // Digests (episode_digest, initial_receipt_digest, receipt_digest) remain strictly identical across all 3 modes
      const epOff = JSON.parse(await readFile(join(journalOff, sessionRef, `${sha256('turn-1')}.episode.json`), 'utf8'));
      const epV3 = JSON.parse(await readFile(join(journalV3, sessionRef, `${sha256('turn-1')}.episode.json`), 'utf8'));
      const epWm = JSON.parse(await readFile(join(journalWm, sessionRef, `${sha256('turn-1')}.episode.json`), 'utf8'));
      expect(epOff.episode_digest).toBe(epV3.episode_digest);
      expect(epOff.episode_digest).toBe(epWm.episode_digest);
      expect(epOff.initial_receipt_digest).toBe(epV3.initial_receipt_digest);
      expect(epOff.initial_receipt_digest).toBe(epWm.initial_receipt_digest);
      expect(epOff.adoption.receipt_digest).toBe(epV3.adoption.receipt_digest);
      expect(epOff.adoption.receipt_digest).toBe(epWm.adoption.receipt_digest);
      expect(epOff.request_text_digest).toBe(epWm.request_text_digest);
      expect(outOff.receipt).toEqual(outWm.receipt);
      // Hook output contract keys strictly unchanged
      expect(Object.keys(outWm).sort()).toEqual(Object.keys(outOff).sort());

      // Non-digest telemetry recorded accurately across all 4 evaluations
      expect(telemetryEvents).toEqual([
        expect.objectContaining({
          event: 'judgment_reasoning_gate_evaluated',
          reasoning_gate_mode: 'off',
          reasoning_gate_applied: false,
          reasoning_gate_eligible: true,
          session_wm_injected: false,
          replay: false,
        }),
        expect.objectContaining({
          event: 'judgment_reasoning_gate_evaluated',
          reasoning_gate_mode: 'compact_4block_v3',
          reasoning_gate_applied: true,
          reasoning_gate_eligible: true,
          session_wm_injected: false,
          replay: false,
        }),
        expect.objectContaining({
          event: 'judgment_reasoning_gate_evaluated',
          reasoning_gate_mode: 'compact_4block_with_wm',
          reasoning_gate_applied: true,
          reasoning_gate_eligible: true,
          session_wm_injected: true,
          replay: false,
        }),
        expect.objectContaining({
          event: 'judgment_reasoning_gate_evaluated',
          reasoning_gate_mode: 'compact_4block_with_wm',
          reasoning_gate_applied: true,
          reasoning_gate_eligible: true,
          session_wm_injected: true,
          replay: true,
        }),
      ]);

      // Structured stderr telemetry emitted for active gate modes with required fields
      const stderrRecords = stderrSpy.mock.calls.map(([chunk]) => JSON.parse(String(chunk)));
      expect(stderrRecords).toHaveLength(3);
      expect(stderrRecords[0]).toMatchObject({
        event: 'judgment_reasoning_gate_evaluated',
        reasoning_gate_mode: 'compact_4block_v3',
        reasoning_gate_applied: true,
      });
      expect(stderrRecords[1]).toMatchObject({
        event: 'judgment_reasoning_gate_evaluated',
        reasoning_gate_mode: 'compact_4block_with_wm',
        reasoning_gate_applied: true,
        session_wm_injected: true,
      });
    });

    it('excludes both gate prompt and WM pin on needs_clarification / clarification.v1 and stays fail-open on corrupt WM or throwing telemetry', async () => {
      const root = await tempDir();
      const journal = join(root, 'journal');
      const sessionId = 'wm-clarification-session';
      const sessionRef = sha256(sessionId);
      await writeSessionMiniWorldModelV2(journal, sessionRef, sampleState({ session_ref: sessionRef }));

      const env = {
        BRAINBASE_JUDGMENT_JOURNAL_DIR: journal,
        BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_with_wm',
        BRAINBASE_JUDGMENT_REASONING_GATE_TELEMETRY: 'off',
      };

      const telemetry: ReasoningGateTelemetryEvent[] = [];
      const clarificationOut = await runJudgmentHost({
        hook_event_name: 'UserPromptSubmit',
        prompt: 'それでいい',
        session_id: sessionId,
        turn_id: 'turn-clarify',
        cwd: root,
      }, {
        env,
        trustedConversationMessages: [],
        onReasoningGateTelemetry: (e) => telemetry.push(e),
      });

      expect(clarificationOut.receipt.status).toBe('needs_clarification');
      expect(clarificationOut.hookSpecificOutput.additionalContext).not.toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);
      expect(clarificationOut.hookSpecificOutput.additionalContext).not.toContain('[Session Mini World Model v2');
      expect(telemetry[0]).toMatchObject({
        reasoning_gate_mode: 'compact_4block_with_wm',
        reasoning_gate_applied: false,
        reasoning_gate_eligible: false,
        session_wm_injected: false,
      });

      // Defense in depth: clarification.v1 DAG with resolved status also excludes WM pin
      const dagClarifyOut = await runJudgmentHost({
        hook_event_name: 'UserPromptSubmit',
        prompt: '方針を説明して',
        session_id: sessionId,
        turn_id: 'turn-clarify-dag',
        cwd: root,
      }, {
        env,
        resolver: async (req) => {
          const base = await resolveLocalJudgment(req);
          return rehashReceipt({ ...base, status: 'resolved', selected_dag_ids: ['clarification.v1'] });
        },
        onReasoningGateTelemetry: () => { throw new Error('telemetry sink exploded'); },
      });
      expect(dagClarifyOut.hookSpecificOutput.additionalContext).not.toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);
      expect(dagClarifyOut.hookSpecificOutput.additionalContext).not.toContain('[Session Mini World Model v2');

      // Corrupt WM file on disk fails open while still injecting v3.1 gate prompt
      const { filePath } = sessionWorldModelPaths(journal, sessionRef);
      await writeFile(filePath, '{corrupted', 'utf8');
      const corruptOut = await runJudgmentHost({
        hook_event_name: 'UserPromptSubmit',
        prompt: '設計案を評価して',
        session_id: sessionId,
        turn_id: 'turn-corrupt-wm',
        cwd: root,
      }, { env });
      expect(corruptOut.hookSpecificOutput.additionalContext).toContain(COMPACT_FOUR_BLOCK_GATE_PROMPT_V3);
      expect(corruptOut.hookSpecificOutput.additionalContext).not.toContain('[Session Mini World Model v2');
    });
  });

  describe('finalizeEpisode() Stop lifecycle (outside withTurnLock, fail-open, idempotent, no audit_repair)', () => {
    it('invokes updater STRICTLY AFTER withTurnLock releases, strips audit lines from final_answer, and skips replay Stop idempotently', async () => {
      const root = await tempDir();
      const journal = join(root, 'journal');
      const sessionId = 'wm-stop-lifecycle';
      const sessionRef = sha256(sessionId);
      const turnId = 'turn-1';
      const env = {
        BRAINBASE_JUDGMENT_JOURNAL_DIR: journal,
        BRAINBASE_JUDGMENT_PROJECT_CODE: 'brainbase',
        BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_with_wm',
        BRAINBASE_JUDGMENT_REASONING_GATE_PROJECTS: 'brainbase',
        BRAINBASE_JUDGMENT_REASONING_GATE_TELEMETRY: 'off',
      };

      const started = await runJudgmentHost({
        hook_event_name: 'UserPromptSubmit',
        prompt: '決済基盤の段階移行方針を評価して',
        session_id: sessionId,
        turn_id: turnId,
        cwd: root,
      }, { env });
      const ownerLine = started.hookSpecificOutput.additionalContext
        .split('\n')
        .find((line) => line.startsWith('🧠')) ?? '';
      const turnLockPath = join(journal, sessionRef, `${sha256(turnId)}.lock`);

      const received: Array<{ event: SessionWorldModelUpdateEventV2; turnLockExistsDuringEnqueue: boolean }> = [];
      const updater: SessionWorldModelUpdaterV2 = {
        enqueue: async (event) => {
          received.push({
            event,
            turnLockExistsDuringEnqueue: existsSync(turnLockPath),
          });
          // Simulate persisting the extracted WM v2 state
          await writeSessionMiniWorldModelV2(journal, event.session_ref, sampleState({
            session_ref: event.session_ref,
            turn_sequence: event.turn_sequence,
            updated_after_turn_id: event.turn_id,
          }));
        },
      };

      const fullAnswer = [
        ownerLine,
        '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓',
        '1. 【主張の幹（Steelman）】段階移行で無停止を維持する仮説。',
        '2. 【母数・代表性と支持/反証】母数は未観測（unknown）。',
      ].join('\n');

      const stop1 = await processJudgmentHook({
        hook_event_name: 'Stop',
        session_id: sessionId,
        turn_id: turnId,
        last_assistant_message: fullAnswer,
      }, { env, sessionWorldModelUpdater: updater });

      expect(stop1).toMatchObject({ completion_status: 'complete', owner_audit_complete: true });
      expect(received).toHaveLength(1);
      // CRITICAL: per-turn lock MUST already be released when enqueue() executes!
      expect(received[0].turnLockExistsDuringEnqueue).toBe(false);
      expect(existsSync(turnLockPath)).toBe(false);
      expect(received[0].event).toEqual({
        session_ref: sessionRef,
        turn_id: turnId,
        turn_sequence: 1,
        user_prompt: '決済基盤の段階移行方針を評価して',
        final_answer: [
          '1. 【主張の幹（Steelman）】段階移行で無停止を維持する仮説。',
          '2. 【母数・代表性と支持/反証】母数は未観測（unknown）。',
        ].join('\n'),
        previous_state: null,
      });

      // Replay Stop for the same turn MUST skip updater idempotently (updated_after_turn_id === turnId)
      const stopReplay = await processJudgmentHook({
        hook_event_name: 'Stop',
        session_id: sessionId,
        turn_id: turnId,
        last_assistant_message: fullAnswer,
      }, { env, sessionWorldModelUpdater: updater });
      expect(stopReplay).toMatchObject({ completion_status: 'complete', owner_audit_complete: true });
      expect(received).toHaveLength(1);

      // Turn 2 gets monotonic turn_sequence = 2 and previous_state from Turn 1
      const turn2Start = await runJudgmentHost({
        hook_event_name: 'UserPromptSubmit',
        prompt: '残り3機能の負荷検証計画を作って',
        session_id: sessionId,
        turn_id: 'turn-2',
        cwd: root,
      }, { env });
      // Turn 2 UserPromptSubmit should automatically inject Turn 1's WM pin!
      expect(turn2Start.hookSpecificOutput.additionalContext).toContain('[Session Mini World Model v2');
      const ownerLine2 = turn2Start.hookSpecificOutput.additionalContext
        .split('\n')
        .find((line) => line.startsWith('🧠')) ?? '';
      await processJudgmentHook({
        hook_event_name: 'Stop',
        session_id: sessionId,
        turn_id: 'turn-2',
        last_assistant_message: [
          ownerLine2,
          '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓',
          '段階的カナリア負荷試験を設計します。',
        ].join('\n'),
      }, { env, sessionWorldModelUpdater: updater });
      expect(received).toHaveLength(2);
      expect(received[1].event.turn_sequence).toBe(2);
      expect(received[1].event.previous_state?.updated_after_turn_id).toBe('turn-1');
    });

    it('never invokes updater on audit_repair Stop (paths.final absent) or when mode is off / compact_4block_v3 / canary mismatch', async () => {
      const root = await tempDir();
      const journal = join(root, 'journal');
      const sessionId = 'wm-stop-guards';
      const env = {
        BRAINBASE_JUDGMENT_JOURNAL_DIR: journal,
        BRAINBASE_JUDGMENT_PROJECT_CODE: 'brainbase',
        BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_with_wm',
        BRAINBASE_JUDGMENT_REASONING_GATE_PROJECTS: 'brainbase',
        BRAINBASE_JUDGMENT_REASONING_GATE_TELEMETRY: 'off',
      };
      const enqueue = vi.fn();

      // 1. audit_repair (missing audit lines -> paths.final NOT written)
      const started = await runJudgmentHost({
        hook_event_name: 'UserPromptSubmit',
        prompt: '設計案をレビューして',
        session_id: sessionId,
        turn_id: 'turn-repair',
        cwd: root,
      }, { env });
      const repairOut = await processJudgmentHook({
        hook_event_name: 'Stop',
        session_id: sessionId,
        turn_id: 'turn-repair',
        last_assistant_message: '監査行を忘れた回答本文',
      }, { env, sessionWorldModelUpdater: { enqueue } });
      expect(repairOut).toMatchObject({ decision: 'block', block_kind: 'audit_repair' });
      expect(enqueue).not.toHaveBeenCalled();

      // 2. Mode compact_4block_v3 (audited completion, but WM disabled)
      const ownerLine = started.hookSpecificOutput.additionalContext
        .split('\n')
        .find((line) => line.startsWith('🧠')) ?? '';
      const finalizedV3 = await processJudgmentHook({
        hook_event_name: 'Stop',
        session_id: sessionId,
        turn_id: 'turn-repair',
        last_assistant_message: [
          ownerLine,
          '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓',
          '監査行を忘れた回答本文',
        ].join('\n'),
      }, {
        env: { ...env, BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_v3' },
        sessionWorldModelUpdater: { enqueue },
      });
      expect(finalizedV3).toMatchObject({ completion_status: 'complete', owner_audit_complete: true });
      expect(enqueue).not.toHaveBeenCalled();

      // 3. Canary mismatch
      const startedOther = await runJudgmentHost({
        hook_event_name: 'UserPromptSubmit',
        prompt: '設計案を評価して',
        session_id: sessionId,
        turn_id: 'turn-canary-miss',
        cwd: root,
      }, { env: { ...env, BRAINBASE_JUDGMENT_PROJECT_CODE: 'other-project' } });
      const ownerLineOther = startedOther.hookSpecificOutput.additionalContext
        .split('\n')
        .find((line) => line.startsWith('🧠')) ?? '';
      await processJudgmentHook({
        hook_event_name: 'Stop',
        session_id: sessionId,
        turn_id: 'turn-canary-miss',
        last_assistant_message: [
          ownerLineOther,
          '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓',
          '評価結果です。',
        ].join('\n'),
      }, {
        env: { ...env, BRAINBASE_JUDGMENT_PROJECT_CODE: 'other-project' },
        sessionWorldModelUpdater: { enqueue },
      });
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('fails open on updater synchronous throw, async rejection, and timeout (with clearTimeout), leaving no lock held', async () => {
      const root = await tempDir();
      const journal = join(root, 'journal');
      const env = {
        BRAINBASE_JUDGMENT_JOURNAL_DIR: journal,
        BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_with_wm',
        BRAINBASE_JUDGMENT_REASONING_GATE_TELEMETRY: 'off',
      };

      const runTurnWithUpdater = async (
        turnId: string,
        updater: SessionWorldModelUpdaterV2,
        timeoutMs = 30,
      ) => {
        const sessionId = 'wm-fail-open-session';
        const started = await runJudgmentHost({
          hook_event_name: 'UserPromptSubmit',
          prompt: `設計検証 ${turnId}`,
          session_id: sessionId,
          turn_id: turnId,
          cwd: root,
        }, { env });
        const ownerLine = started.hookSpecificOutput.additionalContext
          .split('\n')
          .find((line) => line.startsWith('🧠')) ?? '';
        const res = await processJudgmentHook({
          hook_event_name: 'Stop',
          session_id: sessionId,
          turn_id: turnId,
          last_assistant_message: [
            ownerLine,
            '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓',
            '本文回答',
          ].join('\n'),
        }, {
          env,
          sessionWorldModelUpdater: updater,
          sessionWorldModelUpdateTimeoutMs: timeoutMs,
        });
        const turnLock = join(journal, sha256(sessionId), `${sha256(turnId)}.lock`);
        expect(existsSync(turnLock)).toBe(false);
        return res;
      };

      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      // 1. Synchronous throw
      const resSyncThrow = await runTurnWithUpdater('turn-sync-throw', {
        enqueue: () => { throw new Error('sync_updater_boom'); },
      });
      expect(resSyncThrow).toMatchObject({ completion_status: 'complete', owner_audit_complete: true });

      // 2. Async rejection
      const resAsyncReject = await runTurnWithUpdater('turn-async-reject', {
        enqueue: async () => { throw new Error('async_updater_boom'); },
      });
      expect(resAsyncReject).toMatchObject({ completion_status: 'complete', owner_audit_complete: true });

      // 3. Timeout (never settles) -> resolves promptly within timeoutMs and clears timer
      let releaseHanging: (() => void) | undefined;
      const startMs = Date.now();
      const resTimeout = await runTurnWithUpdater('turn-timeout', {
        enqueue: () => new Promise<void>((resolve) => { releaseHanging = resolve; }),
      }, 25);
      const elapsedMs = Date.now() - startMs;
      releaseHanging?.();
      expect(resTimeout).toMatchObject({ completion_status: 'complete', owner_audit_complete: true });
      expect(elapsedMs).toBeLessThan(500);
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(3);
    });

    it('keeps short-lived CLI judgment:hook free of in-process LLM session WM updates on Stop', async () => {
      const root = await tempDir();
      const journal = join(root, 'journal');
      vi.stubEnv('BRAINBASE_JUDGMENT_JOURNAL_DIR', journal);
      vi.stubEnv('BRAINBASE_JUDGMENT_REASONING_GATE_TELEMETRY', 'off');

      const sessionId = 'wm-cli-short-lived';
      const turnId = 'turn-cli-1';

      const startOut = captureCliIo();
      const startCode = await runCli([
        'judgment:hook',
        '--reasoning-gate-mode', 'compact_4block_with_wm',
      ], {
        ...startOut.io,
        stdin: Readable.from([JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          prompt: 'CLIフックでの検証',
          session_id: sessionId,
          turn_id: turnId,
          cwd: root,
        })]),
      });
      expect(startCode).toBe(0);
      const started = JSON.parse(startOut.stdout());
      const ownerLine = String(started.hookSpecificOutput.additionalContext)
        .split('\n')
        .find((line) => line.startsWith('🧠')) ?? '';

      const stopOut = captureCliIo();
      const stopCode = await runCli([
        'judgment:hook',
        '--reasoning-gate-mode', 'compact_4block_with_wm',
      ], {
        ...stopOut.io,
        stdin: Readable.from([JSON.stringify({
          hook_event_name: 'Stop',
          session_id: sessionId,
          turn_id: turnId,
          last_assistant_message: [
            ownerLine,
            '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓',
            'CLI応答本文。',
          ].join('\n'),
        })]),
      });
      expect(stopCode).toBe(0);
      expect(JSON.parse(stopOut.stdout())).toMatchObject({
        completion_status: 'complete',
        owner_audit_complete: true,
      });
      // No session-world-model.json created in-process by short-lived CLI
      expect(readSessionMiniWorldModelV2(journal, sha256(sessionId))).toBeNull();
    });
  });

  describe('remote-judgment-hook-http non-digest telemetry & updater pass-through', () => {
    it('forwards sessionWorldModelUpdater and emits non-digest telemetry without altering HTTP response body', async () => {
      const updater: SessionWorldModelUpdaterV2 = { enqueue: vi.fn() };
      const observedDispatchOpts: unknown[] = [];
      const observedTelemetry: unknown[] = [];

      const response = await handleRemoteJudgmentHookRequest({
        method: 'POST',
        url: '/host/judgment/hook',
        authorization: 'Bearer expected',
        bearerToken: 'expected',
        projectCode: 'brainbase',
        body: Buffer.from(JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          session_id: 'remote-sess-1',
          turn_id: 'turn-1',
        })),
        isAuthorized: (auth, token) => auth === `Bearer ${token}`,
        sessionWorldModelUpdater: updater,
        onReasoningGateTelemetry: (details) => observedTelemetry.push(details),
        dispatch: async (_payload, _projectCode, opts) => {
          observedDispatchOpts.push(opts);
          return {
            output: { continue: true, suppressOutput: true },
            receiptId: 'res-remote-1',
            routeResolutionSha256: 'a'.repeat(64),
            reasoningGateApplied: true,
            reasoningGateMode: 'compact_4block_with_wm',
          };
        },
      });

      expect(response).toEqual({
        status: 200,
        body: {
          schema_version: '1',
          accepted: true,
          hook_event_name: 'UserPromptSubmit',
          session_id: 'remote-sess-1',
          turn_id: 'turn-1',
          receipt_id: 'res-remote-1',
          route_resolution_sha256: 'a'.repeat(64),
          output: { continue: true, suppressOutput: true },
        },
      });
      expect(observedDispatchOpts).toEqual([
        { host: 'remote', sessionWorldModelUpdater: updater },
      ]);
      expect(observedTelemetry).toEqual([
        {
          eventName: 'UserPromptSubmit',
          sessionId: 'remote-sess-1',
          turnId: 'turn-1',
          projectCode: 'brainbase',
          reasoning_gate_applied: true,
          reasoning_gate_mode: 'compact_4block_with_wm',
        },
      ]);

      // Telemetry observer failure must remain fail-open (both sync throws and async rejections)
      const unhandledRejections: unknown[] = [];
      const onUnhandled = (reason: unknown) => { unhandledRejections.push(reason); };
      process.on('unhandledRejection', onUnhandled);
      try {
        const failOpenResp = await handleRemoteJudgmentHookRequest({
          method: 'POST',
          url: '/host/judgment/hook',
          authorization: 'Bearer expected',
          bearerToken: 'expected',
          projectCode: 'brainbase',
          body: Buffer.from(JSON.stringify({
            hook_event_name: 'UserPromptSubmit',
            session_id: 'remote-sess-2',
            turn_id: 'turn-1',
          })),
          isAuthorized: (auth, token) => auth === `Bearer ${token}`,
          onReasoningGateTelemetry: () => { throw new Error('observer_failed'); },
          dispatch: async () => ({
            output: { continue: true },
            receiptId: 'res-remote-2',
            routeResolutionSha256: 'b'.repeat(64),
            reasoningGateApplied: false,
            reasoningGateMode: 'off',
          }),
        });
        expect(failOpenResp?.status).toBe(200);

        const asyncRejectResp = await handleRemoteJudgmentHookRequest({
          method: 'POST',
          url: '/host/judgment/hook',
          authorization: 'Bearer expected',
          bearerToken: 'expected',
          projectCode: 'brainbase',
          body: Buffer.from(JSON.stringify({
            hook_event_name: 'UserPromptSubmit',
            session_id: 'remote-sess-3',
            turn_id: 'turn-1',
          })),
          isAuthorized: (auth, token) => auth === `Bearer ${token}`,
          onReasoningGateTelemetry: async () => {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
            throw new Error('async_http_telemetry_rejected');
          },
          dispatch: async () => ({
            output: { continue: true },
            receiptId: 'res-remote-3',
            routeResolutionSha256: 'c'.repeat(64),
            reasoningGateApplied: true,
            reasoningGateMode: 'compact_4block_with_wm',
          }),
        });
        expect(asyncRejectResp?.status).toBe(200);

        const asyncDispatchErrorResp = await handleRemoteJudgmentHookRequest({
          method: 'POST',
          url: '/host/judgment/hook',
          authorization: 'Bearer expected',
          bearerToken: 'expected',
          projectCode: 'brainbase',
          body: Buffer.from(JSON.stringify({
            hook_event_name: 'UserPromptSubmit',
            session_id: 'remote-sess-4',
            turn_id: 'turn-1',
          })),
          isAuthorized: (auth, token) => auth === `Bearer ${token}`,
          onDispatchError: async () => {
            throw new Error('async_dispatch_error_observer_rejected');
          },
          dispatch: async () => { throw new Error('judgment_receipt_context_mismatch'); },
        });
        expect(asyncDispatchErrorResp).toEqual({
          status: 503,
          body: { error: 'judgment_receipt_context_mismatch' },
        });

        // Host emitReasoningGateTelemetry with async rejecting observer must also stay fail-open
        const root = await tempDir();
        const hostAsyncRejectOut = await runJudgmentHost({
          hook_event_name: 'UserPromptSubmit',
          prompt: '設計方針を評価して',
          session_id: 'wm-async-telemetry-fail-open',
          turn_id: 'turn-async-1',
          cwd: root,
        }, {
          env: {
            BRAINBASE_JUDGMENT_JOURNAL_DIR: join(root, 'journal'),
            BRAINBASE_JUDGMENT_REASONING_GATE_MODE: 'compact_4block_with_wm',
            BRAINBASE_JUDGMENT_REASONING_GATE_TELEMETRY: 'off',
          },
          onReasoningGateTelemetry: async () => {
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
            throw new Error('async_host_telemetry_rejected');
          },
        });
        expect(hostAsyncRejectOut.continue).toBe(true);

        // Allow delayed async rejections to settle and verify zero unhandled rejections.
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
        expect(unhandledRejections).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });

  describe('toLearningCandidateEvidenceDraftFromSessionWMV2 (PR #1044 upstream draft adapter)', () => {
    it('merges invariant + confirmed + superseded into grounds, maps uncertainty & counterexamples, sanitizes/dedupes IDs, and strips credentials', () => {
      const state = sampleState({
        invariant_constraints: [
          'INV-1: 決済データ無停止・ゼロロスト厳守',
          'sk-leak1234567890abcdef',
        ],
        superseded_edges: [
          '全面分割仮説→疎結合3機能のみ分離へ改訂(eval-load-12)',
        ],
        confirmed_edges: [
          'ref-db-07: 決済トランザクション分割でMTTR 2.5倍悪化を確認済み',
          'INV-1: 決済データ無停止・ゼロロスト厳守', // duplicate across buckets -> deduped
        ],
        open_edges: [
          '本番ピーク負荷時の残り3機能レイテンシ推移は未観測',
          'api_key=hidden_secret_999',
        ],
        rejected_false_premises: [
          '単一スタートアップA社事例による傾向仮説の全面棄却は誤り',
          'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig',
        ],
        referenced_refutation_ids: [' ref-db-07 ', 'ref-db-07', 'ref-hire-03', 'sk-leak9999999999999999', ''],
        referenced_eval_ids: [' eval-load-12 ', 'eval-load-12', 'eval-cohort-15', 'ghp_1234567890abcdefghij'],
      });

      const result = toLearningCandidateEvidenceDraftFromSessionWMV2(state, {
        proposedChangeNote: ' 全面分割モデルを改訂し疎結合3機能のみ分離するハイブリッド方針へ更新 ',
        observedCounterexamples: [
          'ステージング検証で決済同期分離のレイテンシ増を確認',
          'password=leaked_value',
        ],
        competingModels: [
          { ref: 'cm-1', hypothesis: '全25機能分割', comparison: 'ref-db-07でMTTR悪化' },
          { ref: 'cm-leak', hypothesis: 'sk-bad1234567890abcdef', comparison: 'should be filtered' },
          { ref: 'api_key=bad', hypothesis: 'clean', comparison: 'clean' },
        ],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.draft.proposedChangeNote).toBe(
          '全面分割モデルを改訂し疎結合3機能のみ分離するハイブリッド方針へ更新',
        );
        expect(result.draft.grounds).toEqual([
          'INV-1: 決済データ無停止・ゼロロスト厳守',
          'ref-db-07: 決済トランザクション分割でMTTR 2.5倍悪化を確認済み',
          '全面分割仮説→疎結合3機能のみ分離へ改訂(eval-load-12)',
        ]);
        expect(result.draft.uncertainty).toEqual([
          '本番ピーク負荷時の残り3機能レイテンシ推移は未観測',
        ]);
        expect(result.draft.counterexamples).toEqual([
          'ステージング検証で決済同期分離のレイテンシ増を確認',
          '単一スタートアップA社事例による傾向仮説の全面棄却は誤り',
        ]);
        expect(result.draft.addressedRefutationIds).toEqual(['ref-db-07', 'ref-hire-03']);
        expect(result.draft.addressedEvalIds).toEqual(['eval-load-12', 'eval-cohort-15']);
        expect(result.draft.competingModels).toEqual([
          { ref: 'cm-1', hypothesis: '全25機能分割', comparison: 'ref-db-07でMTTR悪化' },
        ]);
      }

      // Credential in proposedChangeNote is blanked out
      const secretNote = toLearningCandidateEvidenceDraftFromSessionWMV2(state, {
        proposedChangeNote: 'Use token api_key=secret12345',
      });
      expect(secretNote.ok).toBe(true);
      if (secretNote.ok) {
        expect(secretNote.draft.proposedChangeNote).toBe('');
      }
    });

    it('fails with missing_required_fields when grounds or uncertainty are empty (including after credential filtering)', () => {
      const missingBoth = sampleState({
        invariant_constraints: ['sk-1234567890abcdefghij'],
        confirmed_edges: [],
        superseded_edges: [],
        open_edges: ['password=secret'],
      });
      expect(toLearningCandidateEvidenceDraftFromSessionWMV2(missingBoth, {
        proposedChangeNote: 'empty',
      })).toEqual({
        ok: false,
        missing_required_fields: ['grounds', 'uncertainty'],
      });

      const missingGrounds = sampleState({
        invariant_constraints: [],
        confirmed_edges: [],
        superseded_edges: [],
        open_edges: ['未検証の項目あり'],
      });
      expect(toLearningCandidateEvidenceDraftFromSessionWMV2(missingGrounds, {
        proposedChangeNote: 'no grounds',
      })).toEqual({
        ok: false,
        missing_required_fields: ['grounds'],
      });

      const missingUncertainty = sampleState({
        invariant_constraints: ['INV-1: 必須制約'],
        confirmed_edges: [],
        superseded_edges: [],
        open_edges: [],
      });
      expect(toLearningCandidateEvidenceDraftFromSessionWMV2(missingUncertainty, {
        proposedChangeNote: 'no uncertainty',
      })).toEqual({
        ok: false,
        missing_required_fields: ['uncertainty'],
      });
    });
  });
});
