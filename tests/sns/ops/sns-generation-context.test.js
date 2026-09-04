// @ts-check
import { describe, expect, it } from 'vitest';

import { InMemoryCandidateRepository } from '../../../server/services/candidate-store/candidate-repository.js';
import { SnsGenerationContextService } from '../../../server/services/sns/sns-generation-context-service.js';
import { InMemorySnsPostingLedgerRepository } from '../../../server/services/sns/posting-ledger-repository.js';

const VIEWER = Object.freeze({
    owner_person_id: 'sato_keigo',
    actor_person_id: 'sato_keigo',
    organization_id: 'unson',
    org_ids: ['unson'],
    role: 'ceo',
    projectCodes: ['brainbase']
});

function post(overrides = {}) {
    return {
        id: overrides.id || 'post_default',
        account_id: 'acc_x_sato',
        account_handle: '@AIBizNavigator',
        owner_person_id: 'sato_keigo',
        actor_person_id: 'sato_keigo',
        organization_id: 'unson',
        platform: 'x',
        date: overrides.date || '2026-07-27',
        slot_index: 1,
        time: '09:00',
        title: null,
        status: overrides.status || 'posted',
        lane: overrides.lane || 'work_log',
        format: 'first_person_lifelog',
        body: overrides.body || '今日は運用を見直した。',
        posted_at: '2026-07-27T09:00:00.000Z',
        posted_url: `https://x.com/a/status/${overrides.id || 'post_default'}`,
        deleted_at: overrides.deleted_at || null,
        source: overrides.source || { type: 'Personal KG', url: null },
        evidence: overrides.evidence || {},
        learning_candidate_id: overrides.learning_candidate_id || null,
        metrics_snapshots: overrides.metrics_snapshots || [{
            impressions: 100,
            likes: 2,
            reposts: 0,
            replies: 0,
            bookmarks: 1,
            profile_visits: 0,
            captured_at: '2026-07-27T22:00:00.000Z'
        }],
        ...overrides
    };
}

function candidateRepository() {
    const repo = new InMemoryCandidateRepository();
    const common = {
        owner_person_id: 'sato_keigo',
        actor_person_id: 'sato_keigo',
        organization_id: 'unson',
        workspace: 'unson',
        project_code: 'brainbase',
        org_ids: ['unson'],
        visibility: 'owner',
        sensitivity: 'internal',
        redaction_status: 'none'
    };
    repo.create({
        ...common,
        id: 'lifelog_work',
        source_system: 'oyasumi-meeting-personal-kg',
        cognitive_type: 'insight',
        source_event_ids: ['event:lifelog_work'],
        body: '今日は生成方針を全部見直した。自分の記録から離れない形にした。',
        created_at: '2026-07-28T08:00:00.000Z',
        permission_snapshot: {
            oyasumi_meeting_personal_kg: {
                category: 'work_log',
                memory_layer: 'sns_ready',
                projection_allowed: true
            }
        },
        evidence_ids: [{ uri: 'event:lifelog_work' }]
    });
    repo.create({
        ...common,
        id: 'policy_seed',
        source_system: 'brainbase-personal-kg-seed',
        cognitive_type: 'claim',
        source_event_ids: ['event:policy_seed'],
        body: '人への助言を目的にしない。',
        permission_snapshot: {
            seed: { category: 'operating_principle' }
        }
    });
    repo.create({
        ...common,
        id: 'guarded_secret',
        source_system: 'oyasumi-meeting-personal-kg',
        cognitive_type: 'insight',
        source_event_ids: ['event:guarded_secret'],
        body: '今日は顧客の秘密を見た。',
        sensitivity: 'confidential',
        redaction_status: 'needs_redaction',
        permission_snapshot: {
            oyasumi_meeting_personal_kg: {
                category: 'work_log',
                memory_layer: 'personal_kg_core',
                projection_allowed: false
            }
        }
    });
    return repo;
}

describe('SNS Generation Context', () => {
    it('builds a public-lifelog policy and exposes only eligible first-person sources', async () => {
        const ledgerRepository = new InMemorySnsPostingLedgerRepository({
            authority: VIEWER,
            initialPosts: [
                post({ id: 'posted_log' }),
                post({ id: 'failed_log', status: 'publish_failed', metrics_snapshots: [] }),
                post({ id: 'deleted_log', status: 'deleted', deleted_at: '2026-07-27T12:00:00.000Z' })
            ]
        });
        const service = new SnsGenerationContextService({
            ledgerRepository,
            candidateRepository: candidateRepository(),
            strategyText: [
                '# SNS Strategy OS',
                '## 投稿の約束',
                '- 私はこうだった、で書く',
                '- 助言しない',
                '## 記録の棚',
                '- 今日のログ',
                '- 仕事の記録'
            ].join('\n'),
            contentPillarsText: '# Content Pillars\n- 今日のログ\n- 仕事の記録'
        });

        const context = await service.buildContext({
            date: '2026-07-28',
            viewer: VIEWER
        });

        expect(context.strategy).toMatchObject({
            mode: 'public_lifelog',
            weekly_mix_target: null,
            tone_guard: ['私はこうだった、で書く', '助言しない'],
            distribution_layers: ['今日のログ', '仕事の記録']
        });
        expect(context.personal_kg).toMatchObject({
            retrieval_purpose: 'public_lifelog_generation',
            generation_rule: 'first_person_sources_only',
            guarded_count: 1,
            anchors: [],
            proof_points: [],
            persona_misunderstandings: []
        });
        expect(context.personal_kg.lifelog_entries).toEqual([
            expect.objectContaining({
                id: 'lifelog_work',
                category: 'work_log',
                body: expect.stringContaining('自分の記録')
            })
        ]);
        expect(context.generation_policy).toMatchObject({
            mode: 'public_lifelog',
            recommended_lanes: ['today_log', 'work_log', 'life_log', 'memory', 'unresolved'],
            winning_angles: [],
            quote_target_policy: [],
            source_policy: {
                required: 'actual_first_person_experience',
                missing_source_result: 'zero_posts',
                external_signals: 'reflection_prompts_only'
            }
        });
        expect(context.generation_policy.avoid_patterns).toEqual(expect.arrayContaining([
            'advice_or_instruction',
            'reader_correction_or_persuasion',
            'cta_or_conversion',
            'external_summary_without_lived_experience',
            'invented_first_person_experience'
        ]));
        expect(context.posting_stats.days_7.by_lane.work_log.posts).toBe(1);
        expect(context.learning.publish_failed.map((item) => item.id)).toEqual(['failed_log']);
        expect(context.learning.deleted.map((item) => item.id)).toEqual(['deleted_log']);
    });

    it('states that zero posts is correct when no lived-experience source exists', async () => {
        const service = new SnsGenerationContextService({
            ledgerRepository: new InMemorySnsPostingLedgerRepository({ authority: VIEWER }),
            candidateRepository: new InMemoryCandidateRepository()
        });

        const context = await service.buildContext({
            date: '2026-07-28',
            viewer: VIEWER
        });

        expect(context.personal_kg.lifelog_entries).toEqual([]);
        expect(context.generation_policy.needs_more_data).toContain('本人の一次体験ソースなし。投稿候補は0件にする');
    });

    it('filters cross-person and cross-tenant Personal KG candidates from generation context', async () => {
        const repository = candidateRepository();
        const base = {
            cognitive_type: 'insight',
            actor_person_id: 'delegated_worker',
            source_system: 'oyasumi-meeting-personal-kg',
            workspace: 'unson',
            project_code: 'brainbase',
            project_ids: ['brainbase'],
            visibility: 'owner',
            sensitivity: 'internal',
            redaction_status: 'none',
            body: '自分の境界確認用の一次体験',
            created_at: '2026-07-27T08:00:00.000Z',
            permission_snapshot: {
                oyasumi_meeting_personal_kg: {
                    category: 'work_log',
                    memory_layer: 'sns_ready',
                    projection_allowed: true
                }
            }
        };
        repository.create({
            ...base,
            id: 'delegated_same_scope',
            owner_person_id: 'sato_keigo',
            organization_id: 'unson',
            org_ids: ['unson'],
            source_event_ids: ['event:delegated_same_scope']
        });
        repository.create({
            ...base,
            id: 'other_person',
            owner_person_id: 'other_person',
            organization_id: 'unson',
            org_ids: ['unson'],
            source_event_ids: ['event:other_person']
        });
        repository.create({
            ...base,
            id: 'other_tenant',
            owner_person_id: 'sato_keigo',
            organization_id: 'other_org',
            org_ids: ['other_org'],
            source_event_ids: ['event:other_tenant']
        });
        const service = new SnsGenerationContextService({
            ledgerRepository: new InMemorySnsPostingLedgerRepository(),
            candidateRepository: repository
        });

        const context = await service.buildContext({
            date: '2026-07-28',
            viewer: VIEWER
        });
        const serialized = JSON.stringify(context.personal_kg);

        expect(serialized).toContain('delegated_same_scope');
        expect(serialized).not.toContain('other_person');
        expect(serialized).not.toContain('other_tenant');
    });

    it('filters cross-person and cross-tenant SNS posts from generation context', async () => {
        const ledgerRepository = new InMemorySnsPostingLedgerRepository({
            authority: VIEWER,
            initialPosts: [
                post({ id: 'own_post' }),
                post({
                    id: 'other_person_post',
                    owner_person_id: 'other_person',
                    actor_person_id: 'other_person'
                }),
                post({
                    id: 'other_tenant_post',
                    organization_id: 'other_org'
                })
            ]
        });
        const service = new SnsGenerationContextService({
            ledgerRepository,
            candidateRepository: new InMemoryCandidateRepository()
        });

        const context = await service.buildContext({
            date: '2026-07-28',
            viewer: VIEWER
        });

        expect(context.posting_stats.days_30.by_lane.work_log.posts).toBe(1);
        expect(context.learning.pending_feedback.map((item) => item.id)).toEqual(['own_post']);
        expect(context.generation_policy.recent_history.posts.map((item) => item.id)).toEqual(['own_post']);
    });
});
