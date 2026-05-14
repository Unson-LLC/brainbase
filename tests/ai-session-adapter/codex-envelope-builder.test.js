// @ts-check
/**
 * Contract test: scripts/ai-session-adapter/codex-envelope-builder.mjs
 * Story: story-ai-session-log-kernel-adapter (P0)
 */

import { describe, it, expect } from 'vitest';
import {
    buildCodexSessionEnvelope,
    deriveWorkspaceAndProject
} from '../../scripts/ai-session-adapter/codex-envelope-builder.mjs';

function jsonl(...records) {
    return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

function sessionMeta(overrides = {}) {
    return {
        type: 'session_meta',
        timestamp: '2026-05-14T09:00:00.000Z',
        payload: {
            id: 'sess-test-001',
            cwd: '/Users/ksato/workspace/code/brainbase',
            originator: 'codex-tui',
            cli_version: '0.130.0',
            git: {
                commit_hash: 'abc123',
                branch: 'develop',
                repository_url: 'https://github.com/Unson-LLC/brainbase-unson'
            },
            ...overrides
        }
    };
}

function turnContext(ts) {
    return { type: 'turn_context', timestamp: ts, payload: {} };
}

function eventMsg(ts) {
    return { type: 'event_msg', timestamp: ts, payload: { msg: 'sample' } };
}

describe('deriveWorkspaceAndProject', () => {
    it('actions-runner cwd → project_code=リポ名', () => {
        const r = deriveWorkspaceAndProject('/Volumes/UNSON-DRIVE/actions-runner/_work/salestailor/salestailor');
        expect(r).toEqual({ workspace: 'unson', project_code: 'salestailor' });
    });

    it('brainbase-worktrees cwd → project suffix を抽出', () => {
        const r = deriveWorkspaceAndProject('/Volumes/UNSON-DRIVE/brainbase-worktrees/session-1777080967793-unson');
        expect(r).toEqual({ workspace: 'unson', project_code: 'unson' });
    });

    it('workspace/code/<proj> cwd', () => {
        const r = deriveWorkspaceAndProject('/Users/ksato/workspace/code/brainbase');
        expect(r).toEqual({ workspace: 'unson', project_code: 'brainbase' });
    });

    it('workspace/projects/<proj> cwd', () => {
        const r = deriveWorkspaceAndProject('/Users/ksato/workspace/projects/mana');
        expect(r).toEqual({ workspace: 'unson', project_code: 'mana' });
    });

    it('cwd 未指定 → workspace=unson, project_code=null', () => {
        const r = deriveWorkspaceAndProject(undefined);
        expect(r).toEqual({ workspace: 'unson', project_code: null });
    });

    it('unknown shape の cwd → 最終 segment が project_code に', () => {
        const r = deriveWorkspaceAndProject('/some/random/path/foo');
        expect(r.workspace).toBe('unson');
        expect(r.project_code).toBe('foo');
    });
});

describe('buildCodexSessionEnvelope', () => {
    it('最小入力 (session_meta + 1 イベント) で envelope が生成される', () => {
        const text = jsonl(sessionMeta(), turnContext('2026-05-14T09:01:00.000Z'));
        const { envelope, warnings } = buildCodexSessionEnvelope({
            jsonlText: text,
            filePath: '/Users/ksato/.codex/sessions/2026/05/14/rollout-2026-05-14T09-00-00-sess-test-001.jsonl',
            capturedAt: '2026-05-14T10:00:00.000Z'
        });
        expect(warnings).toEqual([]);
        expect(envelope.raw_event_id).toBe('sess-test-001');
        expect(envelope.source_system).toBe('codex_session');
        expect(envelope.source_event_id).toBe('sess-test-001');
        expect(envelope.occurred_at).toBe('2026-05-14T09:00:00.000Z');
        expect(envelope.captured_at).toBe('2026-05-14T10:00:00.000Z');
        expect(envelope.actor_external_id).toBe('codex:sess-test-001');
        expect(envelope.actor_person_id).toBe('person:ksato');
        expect(envelope.workspace).toBe('unson');
        expect(envelope.project_code).toBe('brainbase');
        expect(envelope.permission_snapshot.roles).toEqual(['user']);
        expect(envelope.permission_snapshot.clearance).toEqual(['internal']);
        expect(envelope.evidence_ref.kind).toBe('source_pointer');
        expect(envelope.evidence_ref.uri.startsWith('file:///Users/ksato/.codex/')).toBe(true);
        expect(envelope.evidence_ref.hash.startsWith('sha256:')).toBe(true);
        expect(envelope.retention_policy).toBe('envelope_only');
        expect(envelope.snippet).toBe('');
        expect(envelope.meta.event_count).toBe(2);
        expect(envelope.meta.originator).toBe('codex-tui');
        expect(envelope.meta.cli_version).toBe('0.130.0');
        expect(envelope.meta.session_started_at).toBe('2026-05-14T09:00:00.000Z');
        expect(envelope.meta.session_ended_at).toBe('2026-05-14T09:01:00.000Z');
        expect(envelope.meta.git.branch).toBe('develop');
    });

    it('jsonl 空 → throw', () => {
        expect(() => buildCodexSessionEnvelope({
            jsonlText: '',
            filePath: '/tmp/empty.jsonl'
        })).toThrow(/non-empty string/);
    });

    it('session_meta 欠落 → throw', () => {
        const text = jsonl(turnContext('2026-05-14T09:00:00.000Z'));
        expect(() => buildCodexSessionEnvelope({
            jsonlText: text,
            filePath: '/tmp/no-meta.jsonl'
        })).toThrow(/session_meta event missing/);
    });

    it('session_meta.payload.id 欠落 → throw', () => {
        const meta = sessionMeta();
        delete meta.payload.id;
        const text = jsonl(meta);
        expect(() => buildCodexSessionEnvelope({
            jsonlText: text,
            filePath: '/tmp/no-id.jsonl'
        })).toThrow(/payload.id missing/);
    });

    it('壊れた行が混じっていても session_meta があれば envelope を返す (robust)', () => {
        const text = jsonl(sessionMeta()) + '{this is broken json\n' + jsonl(eventMsg('2026-05-14T09:05:00.000Z'));
        const { envelope } = buildCodexSessionEnvelope({
            jsonlText: text,
            filePath: '/tmp/partial.jsonl'
        });
        expect(envelope.raw_event_id).toBe('sess-test-001');
        // 壊れた 1 行は skip された、 残り 2 events
        expect(envelope.meta.event_count).toBe(2);
    });

    it('cwd が actions-runner なら project_code=リポ名になる', () => {
        const text = jsonl(sessionMeta({ cwd: '/Volumes/UNSON-DRIVE/actions-runner/_work/salestailor/salestailor' }));
        const { envelope } = buildCodexSessionEnvelope({
            jsonlText: text,
            filePath: '/tmp/salestailor.jsonl'
        });
        expect(envelope.project_code).toBe('salestailor');
    });

    it('actorPersonId override が効く', () => {
        const text = jsonl(sessionMeta());
        const { envelope } = buildCodexSessionEnvelope({
            jsonlText: text,
            filePath: '/tmp/x.jsonl',
            actorPersonId: 'person:test-user'
        });
        expect(envelope.actor_person_id).toBe('person:test-user');
    });

    it('同じ jsonl → 同じ raw_event_id (idempotent key)', () => {
        const text = jsonl(sessionMeta());
        const { envelope: e1 } = buildCodexSessionEnvelope({ jsonlText: text, filePath: '/tmp/a.jsonl' });
        const { envelope: e2 } = buildCodexSessionEnvelope({ jsonlText: text, filePath: '/tmp/a.jsonl' });
        expect(e1.raw_event_id).toBe(e2.raw_event_id);
    });
});
