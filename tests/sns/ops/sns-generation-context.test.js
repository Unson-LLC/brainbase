// @ts-check
import { describe, expect, it } from 'vitest';

import { InMemoryCandidateRepository } from '../../../server/services/candidate-store/candidate-repository.js';
import { SnsGenerationContextService } from '../../../server/services/sns/sns-generation-context-service.js';
import { InMemorySnsPostingLedgerRepository } from '../../../server/services/sns/posting-ledger-repository.js';

function post(overrides = {}) {
    return {
        id: overrides.id || 'post_default',
        account_id: 'acc_x_sato',
        account_handle: '@AIBizNavigator',
        platform: 'x',
        date: overrides.date || '2026-05-15',
        slot_index: overrides.slot_index || 1,
        time: overrides.time || '09:00',
        title: overrides.title || 'Claude Code法人導入',
        status: overrides.status || 'posted',
        lane: overrides.lane || 'trust_balance',
        format: overrides.format || 'standalone',
        body: overrides.body || 'Claude Codeを会社で使う時、権限とレビュー境界を先に決める',
        scheduled_at: null,
        posted_at: overrides.posted_at || `${overrides.date || '2026-05-15'}T09:00:00.000Z`,
        posted_url: overrides.posted_url || `https://x.com/a/status/${overrides.id || 'post_default'}`,
        deleted_at: overrides.deleted_at || null,
        deletion_source: overrides.deletion_source || null,
        deletion_reason: overrides.deletion_reason || null,
        source: overrides.source || { type: 'Personal KG', url: null },
        evidence: overrides.evidence || {
            persona_brain: { target_person: 'AI導入を任された事業責任者 / PM / 経営者' },
            quality_gate: {
                persona_affect: { decision: 'pass', likely_reader_feeling: '自社導入の順番が見える' }
            },
            algorithm_fit: {
                candidate_source: 'personal_kg_semantic_anchor',
                positive_action: 'bookmark'
            },
            reader_affect: '自社導入の順番が見える'
        },
        memo: '',
        learning_candidate_id: overrides.learning_candidate_id || null,
        revisions: [],
        metrics_snapshots: overrides.metrics_snapshots || [{
            impressions: 900,
            likes: 24,
            reposts: 3,
            replies: 2,
            bookmarks: 12,
            profile_visits: 4,
            captured_at: '2026-05-15T22:00:00.000Z'
        }],
        created_at: '2026-05-15T00:00:00.000Z',
        updated_at: '2026-05-15T00:00:00.000Z',
        ...overrides
    };
}

function candidateRepositoryWithFeedback() {
    const repo = new InMemoryCandidateRepository();
    repo.create({
        id: 'cand_sns_feedback_post_trust',
        cognitive_type: 'observation',
        owner_person_id: 'sato_keigo',
        actor_person_id: 'sato_keigo',
        source_system: 'sns-feedback',
        source_event_ids: ['sns-post:post_trust'],
        workspace: 'unson',
        project_code: 'brainbase',
        org_ids: ['unson'],
        visibility: 'owner',
        sensitivity: 'internal',
        body: 'SNS feedback observation: 権限とレビュー境界の投稿は保存されやすい',
        permission_snapshot: {
            sns: {
                post_id: 'post_trust',
                lane: 'trust_balance',
                engagement_rate: 0.045,
                metrics_snapshot: { impressions: 900, likes: 24, reposts: 3, replies: 2, bookmarks: 12 }
            }
        }
    });
    for (const candidate of [
        {
            id: 'seed_sns_foundation_persona-brain-first',
            source_system: 'brainbase-personal-kg-seed',
            cognitive_type: 'claim',
            project_code: 'brainbase',
            body: 'Persona Brainで考える。SNSでも営業でも、こちらの正しさや分類から始めず、相手が今何を見て、何を誤解し、何を怖がり、何なら自然に動けるかを先に立ち上げる。',
            category: 'philosophy'
        },
        {
            id: 'seed_baao_minutes_ai-pm-mana-proof',
            source_system: 'baao-minutes-personal-kg-seed',
            cognitive_type: 'result',
            project_code: 'baao',
            body: 'Own Proof: MANAによるAI駆動PMは、実運用4ヶ月で会議時間90%削減、PM工数75%削減、タスク登録80%自動化の実績として説明されている。',
            category: 'proof'
        },
        {
            id: 'seed_cross_minutes_high-ticket-sales-human-fear-reduction',
            source_system: 'cross-project-minutes-personal-kg-seed',
            cognitive_type: 'claim',
            project_code: 'salestailor',
            body: 'AI時代の高額商材営業で人間に残る仕事は、相手の決断の恐怖を減らし、納得と責任を支えること。',
            category: 'sales_philosophy'
        }
    ]) {
        repo.create({
            ...candidate,
            owner_person_id: 'sato_keigo',
            actor_person_id: 'sato_keigo',
            source_event_ids: [`${candidate.source_system}:${candidate.id}`],
            workspace: 'unson',
            org_ids: ['unson'],
            project_ids: ['brainbase', candidate.project_code],
            visibility: 'owner',
            sensitivity: 'internal',
            permission_snapshot: {
                seed: {
                    category: candidate.category,
                    item_id: candidate.id,
                    source_project_code: candidate.project_code
                }
            },
            evidence_ids: [{ uri: `seed:${candidate.id}` }]
        });
    }
    repo.create({
        id: 'oyasumi_sensitive_core_ai_sales_agency',
        source_system: 'oyasumi-meeting-personal-kg',
        cognitive_type: 'insight',
        owner_person_id: 'sato_keigo',
        actor_person_id: 'sato_keigo',
        source_event_ids: ['github:minutes#personal_kg_core:ai-sales-agency-confidential-business-context'],
        workspace: 'github',
        project_code: 'salestailor',
        org_ids: ['unson', 'salestailor'],
        project_ids: ['salestailor'],
        visibility: 'owner',
        sensitivity: 'confidential',
        redaction_status: 'needs_redaction',
        body: 'Context: 顧問先の月額予算15万円と月5から10件のリード獲得見込みがある。 Judgment: 自社プロダクト導入機会の入口として見る。',
        permission_snapshot: {
            oyasumi_meeting_personal_kg: {
                category: 'sales_philosophy',
                memory_layer: 'personal_kg_core',
                retrieval_purpose: 'owner_judgment',
                projection_allowed: false,
                projection_gate: 'redact_or_approve_before_sns_team_org'
            }
        }
    });
    repo.create({
        id: 'oyasumi_sns_ready_ai_sales_agency',
        source_system: 'oyasumi-meeting-personal-kg',
        cognitive_type: 'insight',
        owner_person_id: 'sato_keigo',
        actor_person_id: 'sato_keigo',
        source_event_ids: ['github:minutes#sns_ready:ai-sales-agency'],
        workspace: 'github',
        project_code: 'salestailor',
        org_ids: ['unson', 'salestailor'],
        project_ids: ['salestailor'],
        visibility: 'owner',
        sensitivity: 'internal',
        redaction_status: 'none',
        body: 'AI活用支援の相談は案件幅が大きく、営業代行で現金化しながら自社プロダクトの導入機会を作る動線がある。',
        permission_snapshot: {
            oyasumi_meeting_personal_kg: {
                category: 'sales_philosophy',
                memory_layer: 'sns_ready',
                retrieval_purpose: 'sns_generation',
                projection_allowed: true,
                projection_gate: 'sns_projection_can_use_after_context_review'
            }
        }
    });
    return repo;
}

describe('SNS Generation Context', () => {
    it('builds generation policy from strategy, posting stats, and feedback learning candidates', async () => {
        const ledgerRepository = new InMemorySnsPostingLedgerRepository({
            initialPosts: [
                post({ id: 'post_trust', lane: 'trust_balance', source: { type: 'Personal KG' } }),
                post({
                    id: 'post_peer',
                    lane: 'peer_circle',
                    format: 'quote_repost_commentary',
                    source: { type: 'Peer Circle', url: 'https://x.com/peer/status/1', author_handle: '@near_peer' },
                    evidence: {
                        persona_brain: { target_person: 'AI導入を任された事業責任者 / PM / 経営者' },
                        quality_gate: {
                            persona_affect: { decision: 'pass', likely_reader_feeling: '近い実務者の論点として読める' }
                        },
                        algorithm_fit: {
                            candidate_source: 'peer_circle_quote',
                            positive_action: 'reply_or_repost'
                        },
                        reader_affect: '近い実務者の論点として読める'
                    },
                    metrics_snapshots: [{ impressions: 1800, likes: 40, reposts: 9, replies: 6, bookmarks: 11, profile_visits: 10 }]
                }),
                post({ id: 'post_old', date: '2026-04-01', lane: 'own_proof' }),
                post({ id: 'post_failed', status: 'publish_failed', lane: 'trust_balance', metrics_snapshots: [] }),
                post({ id: 'post_skipped', status: 'skipped', lane: 'peer_circle', metrics_snapshots: [] }),
                post({ id: 'post_deleted', status: 'deleted', lane: 'trust_balance', deleted_at: '2026-05-15T12:00:00.000Z' })
            ]
        });
        const service = new SnsGenerationContextService({
            ledgerRepository,
            candidateRepository: candidateRepositoryWithFeedback(),
            strategyText: [
                '# SNS Strategy OS',
                '## Tone Guard',
                '- 読者に運用都合を見せない',
                '- AI投稿自動化感を出さない',
                '## Distribution Layers',
                '- Peer Circle',
                '- Own Proof'
            ].join('\n'),
            contentPillarsText: [
                '# Content Pillars',
                '- Trust Balance',
                '- Own Proof',
                '- Philosophy'
            ].join('\n')
        });

        const context = await service.buildContext({
            date: '2026-05-16',
            viewer: { actor_person_id: 'sato_keigo', org_ids: ['unson'] }
        });

        expect(context).toMatchObject({
            date: '2026-05-16',
            strategy: {
                distribution_layers: expect.arrayContaining(['Peer Circle', 'Own Proof'])
            },
            generation_policy: {
                recommended_lanes: expect.arrayContaining(['peer_circle', 'trust_balance']),
                avoid_patterns: expect.arrayContaining([
                    'internal_growth_tactic_exposed',
                    'ai_auto_posting_smell',
                    'reader_negative_persona_affect'
                ]),
                quote_target_policy: expect.arrayContaining([
                    '日本語圏の同格〜少し上の実務者を優先する'
                ])
            }
        });
        expect(context.lookback.days_7.start_date).toBe('2026-05-10');
        expect(context.posting_stats.days_30.by_lane.trust_balance.posts).toBe(1);
        expect(context.posting_stats.days_30.by_lane.peer_circle.posts).toBe(1);
        expect(context.posting_stats.days_30.by_lane.trust_balance.engagement_rate).toBeGreaterThan(0);
        expect(context.posting_stats.days_30.by_source_type['Peer Circle'].posts).toBe(1);
        expect(context.posting_stats.days_30.by_algorithm_fit.personal_kg_semantic_anchor.posts).toBe(1);
        expect(context.personal_kg.anchors).toEqual(expect.arrayContaining([
            expect.stringContaining('Persona Brainで考える'),
            expect.stringContaining('AI活用支援の相談は案件幅が大きく')
        ]));
        expect(context.personal_kg.retrieval_purpose).toBe('sns_generation');
        expect(context.personal_kg.guarded_count).toBe(1);
        expect(context.personal_kg.anchors.join('\n')).not.toContain('月額予算15万円');
        expect(context.personal_kg.anchors.join('\n')).not.toContain('月5から10件');
        expect(context.personal_kg.proof_points).toEqual(expect.arrayContaining([
            expect.stringContaining('MANAによるAI駆動PM')
        ]));
        expect(context.personal_kg.proof_points.join('\n')).not.toContain('Persona Brain / Peer Circle / Own Proof');
        expect(context.personal_kg.candidate_sources).toEqual(expect.arrayContaining([
            expect.objectContaining({ source_system: 'brainbase-personal-kg-seed', count: 1 }),
            expect.objectContaining({ source_system: 'baao-minutes-personal-kg-seed', count: 1 }),
            expect.objectContaining({ source_system: 'cross-project-minutes-personal-kg-seed', count: 1 }),
            expect.objectContaining({ source_system: 'oyasumi-meeting-personal-kg', count: 1 })
        ]));
        expect(context.generation_policy.winning_angles).toEqual(expect.arrayContaining([
            expect.stringContaining('MANAによるAI駆動PM')
        ]));
        expect(context.learning.created_candidates).toEqual([
            expect.objectContaining({ id: 'cand_sns_feedback_post_trust', source_system: 'sns-feedback' })
        ]);
        expect(context.learning.publish_failed.map((item) => item.id)).toEqual(['post_failed']);
        expect(context.learning.skipped.map((item) => item.id)).toEqual(['post_skipped']);
        expect(context.learning.deleted.map((item) => item.id)).toEqual(['post_deleted']);
        expect(context.learning.publish_failed.every((item) => item.id !== 'post_trust')).toBe(true);
        expect(context.evidence).toEqual(expect.arrayContaining([
            { kind: 'sns_posting_ledger', ref: 'sns_posting_ledger_posts:2026-04-17..2026-05-16' },
            { kind: 'candidate_store', ref: 'memory_candidates owner:sato_keigo' }
        ]));
    });
});
