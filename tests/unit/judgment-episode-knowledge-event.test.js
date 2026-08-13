import { describe, expect, it } from 'vitest';

import { toKnowledgeEventFromJudgmentEpisode } from '../../server/services/routine-runtime/judgment-event-adapter.js';
import {
    InMemoryKnowledgeEventRepository,
    KnowledgeEventService
} from '../../server/services/knowledge-event-service.js';
import { InMemoryCandidateRepository } from '../../server/services/candidate-store/candidate-repository.js';

function completedEpisode(overrides = {}) {
    return {
        episode_id: 'je-session-1-turn-1',
        session_id: 'session-1',
        turn_id: 'turn-1',
        completion_status: 'complete',
        finalized_at: '2026-08-13T00:00:00.000Z',
        prompt_hash: 'sha256:prompt',
        answer_digest: 'sha256:answer',
        final_answer: '価格改定は段階導入する。次回会議で結果を再確認する。',
        route: { intent: 'answer', domains: ['brainbase'] },
        action_allowed: true,
        approval_scope: ['deploy', 'send'],
        ...overrides
    };
}

describe('completed judgment episode knowledge event adapter', () => {
    it('completed episodeだけを決定的knowledge_event.v1へ変換し、行動権限を伝播しない', () => {
        const first = toKnowledgeEventFromJudgmentEpisode(completedEpisode());
        const replay = toKnowledgeEventFromJudgmentEpisode(completedEpisode());

        expect(replay).toEqual(first);
        expect(first).toMatchObject({
            contract_version: 'knowledge_event.v1',
            parent_episode_id: 'je-session-1-turn-1',
            occurred_at: '2026-08-13T00:00:00.000Z',
            source: { type: 'codex_judgment', ref: 'session-1:turn-1' },
            body_hash: 'sha256:answer',
            payload: {
                summary: '価格改定は段階導入する。次回会議で結果を再確認する。'
            },
            source_pointer: {
                uri: 'codex://threads/session-1#turn=turn-1'
            }
        });
        expect(first.event_id).toMatch(/^kev_/);
        expect(first).not.toHaveProperty('action_allowed');
        expect(first).not.toHaveProperty('approval_scope');
        expect(JSON.stringify(first)).not.toContain('deploy');
        expect(JSON.stringify(first)).not.toContain('send');
    });

    it.each(['active', 'blocked'])('%s episodeは登録対象にしない', (completionStatus) => {
        expect(toKnowledgeEventFromJudgmentEpisode(completedEpisode({ completion_status: completionStatus }))).toBeNull();
    });

    it('安全なfinal answer本文がなければhashだけの記憶を成功登録しない', () => {
        expect(toKnowledgeEventFromJudgmentEpisode(completedEpisode({
            final_answer: undefined,
            payload: undefined,
            summary: undefined
        }))).toBeNull();
    });

    it('監査prefixを本文から除外し、安全なsummaryを2000文字以内に制限する', () => {
        const auditPrefix = [
            '🧠 判断参照: 「記憶循環」を参照 → 実装として確認 ✓',
            '📚 Brainbase未参照: 必須参照なし・実呼び出し0回 ✓',
            '⚠️ 注意: 部分確認 ✓'
        ].join('\n');
        const body = `安全な回答本文:${'あ'.repeat(2500)}`;
        const event = toKnowledgeEventFromJudgmentEpisode(completedEpisode({
            final_answer: `${auditPrefix}\n${body}`
        }));

        expect(event.payload.summary).toMatch(/^安全な回答本文:/);
        expect(event.payload.summary.length).toBeLessThanOrEqual(2000);
        expect(event.payload.summary).not.toContain('🧠 判断参照');
        expect(event.payload.summary).not.toContain('📚 Brainbase');
        expect(event.payload.summary).not.toContain('⚠️ 注意');
    });

    it.each([
        ['secret', 'api_key=sk-live-secret-123456789'],
        ['credential', 'password=correct-horse-battery-staple'],
        ['PII', '連絡先はprivate.person@example.comです']
    ])('%sを検出した本文は複製せずquarantined/needs_redactionにする', (_kind, sensitiveBody) => {
        const event = toKnowledgeEventFromJudgmentEpisode(completedEpisode({ final_answer: sensitiveBody }));

        expect(event).toMatchObject({
            semantic_state: 'quarantined',
            payload: { redaction_status: 'needs_redaction' }
        });
        expect(event.payload).not.toHaveProperty('summary');
        expect(JSON.stringify(event)).not.toContain(sensitiveBody);
        expect(JSON.stringify(event)).not.toContain('private.person@example.com');
        expect(JSON.stringify(event)).not.toContain('correct-horse-battery-staple');
        expect(JSON.stringify(event)).not.toContain('sk-live-secret-123456789');
    });

    it('Phase 3正式schemaへ変換しKnowledgeEventService.ingest validatorを通過する', async () => {
        const event = toKnowledgeEventFromJudgmentEpisode(completedEpisode());
        const service = new KnowledgeEventService({
            eventRepository: new InMemoryKnowledgeEventRepository(),
            candidateRepository: new InMemoryCandidateRepository(),
            graphRepository: {}
        });

        expect(event).toMatchObject({
            schema_version: 'knowledge_event.v1',
            decision_authority: expect.any(Object),
            applicability_scope: expect.any(Object)
        });
        await expect(service.ingest(event)).resolves.toMatchObject({ event_id: event.event_id });
    });
});
