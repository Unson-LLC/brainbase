// @ts-check
import { describe, expect, it } from 'vitest';

import { InMemoryCandidateRepository } from '../../../server/services/candidate-store/candidate-repository.js';
import { PromotionGateService } from '../../../server/services/candidate-store/promotion-gate-service.js';
import {
    SOURCE_SYSTEM,
    extractMeetingPersonalKgCandidates,
    extractMeetingPersonalKgCandidatesSemantic,
    projectSnsReadyCandidateFromCore,
    writeMeetingPersonalKgCandidates
} from '../../../server/services/sns/oyasumi-meeting-personal-kg-service.js';
import { SnsGenerationContextService } from '../../../server/services/sns/sns-generation-context-service.js';
import { InMemorySnsPostingLedgerRepository } from '../../../server/services/sns/posting-ledger-repository.js';

const SOCIAL_GATHERING_MINUTES = [
    '---',
    'date: 2026-05-15',
    '---',
    '# 2026-05-15 social gathering business networking talk',
    '',
    '## 要約',
    '本懇親会では、AIを活用した業務効率化案件に関する営業協業について話し合われた。',
    '',
    ':bulb: *AI案件の連携と営業代行*',
    '- AIを活用して業務効率化を図りたい企業からの相談が増加しており、月20万〜半年500万円規模の案件が発生している。',
    '- 堀が営業代行として参画し、キャッシュを稼ぎつつ自社プロダクトの営業機会を作る方針を確認。',
    '- 営業代行として受注した案件から、月5〜10件程度のリード獲得を見込み、自社プロダクトへの導入を促す。予想される月額予算は15万円程度。',
    '',
    ':family: *個人的な近況（Speaker 1の家族について）*',
    '- Speaker 1の娘さんは、特有の遺伝的疾患により体の構造が特殊で、心臓の大動脈が気管を圧迫する症状が顕在化している。',
    '- 25日に心臓の大動脈を処置する大手術を予定しており、医師と手術法を相談した。',
    '',
    ':busts_in_silhouette: *その他・親睦*',
    '- AIプロンプトの活用方法についてSlackのDMで共有。'
].join('\n');

const DINNER_MINUTES = [
    '---',
    'date: 2026-05-15',
    '---',
    '# 2026-05-15 business ai future dinner meeting',
    '',
    ':handshake: *SalesTailor導入に関する合意*',
    '- パーソナライズされた手書き手紙サービス「SalesTailor」の正式導入が決定',
    '- 高単価・未定形商材の営業において、商談化率3%→10%への改善実績が評価された',
    '- 堀さんの文面作成のこだわりと営業経験に基づく知見が、平井社長から本質的に伸びると高く評価',
    '',
    ':robot: *AI活用と業務効率化*',
    '- 個人レベルのAI活用は進んでいるが、組織的活用はまだ3%未満という現状認識で一致',
    '- 佐藤さん: AIを使いこなせる人と使えない人は100%分かれる。重要なのは審美眼',
    '- 佐藤さんから堀さんへ「生意気なChatGPTプロンプト」をDMで共有済み'
].join('\n');

const DINNER_TRANSCRIPT = [
    '佐藤: Claude CodeとCodexはどちらか一方ではなく、タスクとトークンの向き不向きで使い分けている。',
    '佐藤: AIを使う上で重要なのは審美眼。AIに媚びさせるのではなく、生意気なChatGPTとして議論させる。',
    '佐藤: 自分の哲学をデータベースやルールに入れておく。俺の脳で考えて、と言えば関連する思想を取り出してAIが判断できるようにする。',
    '佐藤: AIはExcelのように民主化する。差が出るのはツールを触れるかではなく、会社で使える形に落とす設計である。'
].join('\n');

function sampleMeetings() {
    return [
        {
            repo: 'Unson-LLC/salestailor-project',
            path: 'meetings/minutes/2026-05-15_social-gathering-business-networking-talk.md',
            html_url: 'https://github.com/Unson-LLC/salestailor-project/blob/main/meetings/minutes/2026-05-15_social-gathering-business-networking-talk.md',
            sha: '1b7c3f999a0a0f8bb339cee62c06353b02c3dafa',
            project_code: 'salestailor',
            content: SOCIAL_GATHERING_MINUTES
        },
        {
            repo: 'Unson-LLC/salestailor-project',
            path: 'meetings/minutes/2026-05-15_business-ai-future-dinner-meeting.md',
            html_url: 'https://github.com/Unson-LLC/salestailor-project/blob/main/meetings/minutes/2026-05-15_business-ai-future-dinner-meeting.md',
            sha: '69a8001f8fc6e69c98c2c231efcf5aa200bfe2c8',
            project_code: 'salestailor',
            content: DINNER_MINUTES,
            transcript_path: 'meetings/transcripts/2026-05-15_business-ai-future-dinner-meeting.txt',
            transcript_content: DINNER_TRANSCRIPT
        }
    ];
}

describe('Oyasumi meeting minutes to Personal KG', () => {
    it('S-1/INV-2 extracts personal core details and rejects them from SNS projection', () => {
        const result = extractMeetingPersonalKgCandidates({
            date: '2026-05-15',
            meetings: sampleMeetings()
        });
        const coreCandidates = result.adopted.filter((candidate) => (
            candidate.permission_snapshot.oyasumi_meeting_personal_kg.memory_layer === 'personal_kg_core'
        ));
        const snsReadyCandidates = result.adopted.filter((candidate) => (
            candidate.permission_snapshot.oyasumi_meeting_personal_kg.memory_layer === 'sns_ready'
        ));

        expect(result.source_system).toBe(SOURCE_SYSTEM);
        expect(result.agent_reports).toEqual(expect.arrayContaining([
            expect.objectContaining({ role: 'meeting_harvester', status: 'completed' }),
            expect.objectContaining({ role: 'personal_kg_extractor', status: 'completed' }),
            expect.objectContaining({ role: 'sensitivity_reviewer', status: 'completed' }),
            expect.objectContaining({ role: 'sns_projection', status: 'completed' })
        ]));
        expect(result.adopted).toEqual(expect.arrayContaining([
            expect.objectContaining({
                source_system: SOURCE_SYSTEM,
                owner_person_id: 'sato_keigo',
                project_code: 'salestailor',
                visibility: 'owner',
                cognitive_type: 'insight',
                body: expect.stringContaining('AI活用支援の相談は月20万から半年500万円規模')
            }),
            expect.objectContaining({
                cognitive_type: 'result',
                body: expect.stringContaining('商談化率3%から10%')
            })
        ]));
        expect(result.adopted[0].source_event_ids[0]).toContain('github:Unson-LLC/salestailor-project:meetings/minutes/2026-05-15_');
        expect(new Set(result.adopted.map((candidate) => candidate.id)).size).toBe(result.adopted.length);
        expect(result.adopted[0].permission_snapshot.oyasumi_meeting_personal_kg.meeting_date).toBe('2026-05-15');
        expect(coreCandidates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sensitivity: 'confidential',
                redaction_status: 'needs_redaction',
                body: expect.stringMatching(/娘|心臓|手術|医師|家族/u)
            })
        ]));
        expect(snsReadyCandidates.map((candidate) => candidate.body).join('\n')).not.toMatch(/娘|心臓|手術|医師|家族|懇親会|飲み会/u);
        expect(result.rejected).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: 'medical_or_health' })
        ]));
    });

    it('S-1/INV-2 extracts transcript-derived personal_kg_core before SNS projection', () => {
        const result = extractMeetingPersonalKgCandidates({
            date: '2026-05-15',
            meetings: sampleMeetings()
        });

        const coreCandidates = result.adopted.filter((candidate) => (
            candidate.permission_snapshot.oyasumi_meeting_personal_kg.memory_layer === 'personal_kg_core'
        ));
        const snsReadyCandidates = result.adopted.filter((candidate) => (
            candidate.permission_snapshot.oyasumi_meeting_personal_kg.memory_layer === 'sns_ready'
        ));

        expect(coreCandidates).toEqual(expect.arrayContaining([
            expect.objectContaining({
                cognitive_type: 'claim',
                body: expect.stringContaining('俺の脳で考えて')
            }),
            expect.objectContaining({
                cognitive_type: 'preference',
                body: expect.stringContaining('AIに媚びさせるのではなく')
            })
        ]));
        expect(coreCandidates.map((candidate) => (
            candidate.permission_snapshot.oyasumi_meeting_personal_kg.source_kind
        ))).toContain('transcript');
        expect(snsReadyCandidates.length).toBeGreaterThan(0);
        expect(snsReadyCandidates.every((candidate) => (
            candidate.permission_snapshot.oyasumi_meeting_personal_kg.projection_of
        ))).toBe(true);
    });

    it('INV-1 does not mark transcript aggregation as fully completed when core extraction finds nothing', () => {
        const result = extractMeetingPersonalKgCandidates({
            date: '2026-05-15',
            meetings: [{
                repo: 'Unson-LLC/salestailor-project',
                path: 'meetings/minutes/2026-05-15_empty.md',
                project_code: 'salestailor',
                content: '# empty',
                transcript_path: 'meetings/transcripts/2026-05-15_empty.txt',
                transcript_content: '雑談のみで、判断基準として残す内容はない。'
            }]
        });

        expect(result.agent_reports).toEqual(expect.arrayContaining([
            expect.objectContaining({
                role: 'personal_kg_extractor',
                status: 'needs_review',
                output_count: 0
            })
        ]));
    });

    it('S-2 skips duplicates by stable source_event_ids', async () => {
        const repository = new InMemoryCandidateRepository();
        const candidateService = new PromotionGateService({ repository });
        const extracted = extractMeetingPersonalKgCandidates({
            date: '2026-05-15',
            meetings: sampleMeetings()
        });

        const first = await writeMeetingPersonalKgCandidates({ candidateService, extracted });
        const second = await writeMeetingPersonalKgCandidates({ candidateService, extracted });

        expect(first.inserted).toBeGreaterThan(0);
        expect(first.skipped).toBe(0);
        expect(second.inserted).toBe(0);
        expect(second.skipped).toBe(first.inserted);
        expect(repository.list({ owner_person_id: 'sato_keigo' })).toHaveLength(first.inserted);
    });

    it('S-3 makes written candidates available to SNS Generation Context', async () => {
        const repository = new InMemoryCandidateRepository();
        const candidateService = new PromotionGateService({ repository });
        for (let index = 0; index < 12; index += 1) {
            repository.create({
                id: `old_seed_${index}`,
                cognitive_type: 'claim',
                owner_person_id: 'sato_keigo',
                actor_person_id: 'sato_keigo',
                source_system: 'brainbase-personal-kg-seed',
                source_event_ids: [`seed:${index}`],
                workspace: 'github',
                project_code: 'brainbase',
                org_ids: ['unson'],
                project_ids: ['brainbase'],
                visibility: 'owner',
                sensitivity: 'internal',
                confidence: 0.99,
                body: `古い高confidence seed ${index}`,
                permission_snapshot: {
                    seed: { category: 'philosophy' }
                }
            });
        }
        const extracted = extractMeetingPersonalKgCandidates({
            date: '2026-05-15',
            meetings: sampleMeetings()
        });
        const snsReadyCount = extracted.adopted.filter((candidate) => (
            candidate.permission_snapshot.oyasumi_meeting_personal_kg.memory_layer === 'sns_ready'
        )).length;
        await writeMeetingPersonalKgCandidates({ candidateService, extracted });

        const contextService = new SnsGenerationContextService({
            ledgerRepository: new InMemorySnsPostingLedgerRepository({ initialPosts: [] }),
            candidateRepository: repository
        });

        const context = await contextService.buildContext({
            date: '2026-05-16',
            viewer: { actor_person_id: 'sato_keigo', org_ids: ['unson', 'salestailor'] }
        });

        expect(context.personal_kg.candidate_sources).toEqual(expect.arrayContaining([
            expect.objectContaining({ source_system: SOURCE_SYSTEM, count: snsReadyCount })
        ]));
        expect(context.personal_kg.anchors).toEqual(expect.arrayContaining([
            expect.stringContaining('AI活用支援の相談')
        ]));
        expect(context.personal_kg.proof_points).toEqual(expect.arrayContaining([
            expect.stringContaining('商談化率3%から10%')
        ]));
    });

    it('projects owner-only core into redacted sns_ready candidate without leaking details', () => {
        const extracted = extractMeetingPersonalKgCandidates({
            date: '2026-05-15',
            meetings: sampleMeetings()
        });
        const core = extracted.adopted.find((candidate) => (
            candidate.permission_snapshot.oyasumi_meeting_personal_kg.memory_layer === 'personal_kg_core'
            && candidate.permission_snapshot.oyasumi_meeting_personal_kg.rule_id === 'ai-sales-agency-confidential-business-context'
        ));

        const projected = projectSnsReadyCandidateFromCore(core);

        expect(projected).toEqual(expect.objectContaining({
            source_system: SOURCE_SYSTEM,
            sensitivity: 'internal',
            redaction_status: 'none',
            recommended_subject_type: 'sns_ready',
            body: expect.stringContaining('Reusable Pattern:')
        }));
        expect(projected.permission_snapshot.oyasumi_meeting_personal_kg).toEqual(expect.objectContaining({
            memory_layer: 'sns_ready',
            projection_of: core.id,
            retrieval_purpose: 'sns_generation',
            projection_allowed: true
        }));
        expect(projected.body).not.toMatch(/月20万|半年500万円|月額予算15万円|月5[〜~\-から]10件|娘|心臓|手術|医師|家族/u);
    });

    it('does not project restricted private core details into sns_ready', () => {
        const core = {
            id: 'private-core',
            cognitive_type: 'observation',
            owner_person_id: 'sato_keigo',
            source_system: SOURCE_SYSTEM,
            source_event_ids: ['github:meeting#private'],
            workspace: 'github',
            visibility: 'owner',
            sensitivity: 'restricted',
            redaction_status: 'needs_redaction',
            confidence: 0.8,
            body: 'Context: 個人的な事情と報酬条件を含む。 Judgment: 本人の判断再現にだけ使い、SNS・team・org projectionにはそのまま出さない。',
            permission_snapshot: {
                oyasumi_meeting_personal_kg: {
                    category: 'private_or_family',
                    memory_layer: 'personal_kg_core',
                    retrieval_purpose: 'owner_judgment',
                    projection_allowed: false,
                    sns_projection_allowed: false,
                    source_ref: 'github:meeting#private'
                }
            },
            evidence_ids: []
        };

        expect(projectSnsReadyCandidateFromCore(core)).toBeNull();
    });

    it('does not project semantic confidential core details into sns_ready', () => {
        const core = {
            id: 'semantic-confidential-core',
            cognitive_type: 'insight',
            owner_person_id: 'sato_keigo',
            source_system: SOURCE_SYSTEM,
            source_event_ids: ['github:meeting#semantic-confidential'],
            workspace: 'github',
            visibility: 'owner',
            sensitivity: 'confidential',
            redaction_status: 'needs_redaction',
            confidence: 0.8,
            body: 'Context: 相手企業の未公開業務制約を含む。 Judgment: 本人判断には有用。 Reusable Pattern: まず業務制約を読む。 Apply When: 類似案件。 Do Not Apply When: 公開SNS素材。',
            permission_snapshot: {
                oyasumi_meeting_personal_kg: {
                    category: 'business_judgment',
                    memory_layer: 'personal_kg_core',
                    agent_role: 'semantic_personal_kg_extractor',
                    retrieval_purpose: 'owner_judgment',
                    projection_allowed: false,
                    sns_projection_allowed: false,
                    source_ref: 'github:meeting#semantic-confidential'
                }
            },
            evidence_ids: []
        };

        expect(projectSnsReadyCandidateFromCore(core)).toBeNull();
    });

    it('extracts semantic personal_kg_core candidates through an injected LLM client', async () => {
        const extracted = await extractMeetingPersonalKgCandidatesSemantic({
            date: '2026-05-15',
            meetings: sampleMeetings(),
            llmClient: {
                async extractPersonalKgCandidates() {
                    return {
                        candidates: [{
                            key: 'relationship-context-before-draft',
                            category: 'operating_principle',
                            cognitive_type: 'preference',
                            sensitivity: 'internal',
                            redaction_status: 'none',
                            confidence: 0.82,
                            source_kind: 'transcript',
                            body: 'Context: 佐藤はAIに自分の哲学をDBやルールから取り出して判断させたいと話している。 Judgment: 返信や提案の生成では、文面だけではなく思想と関係性を取り出して判断する必要がある。 Reusable Pattern: AIに作業を渡す前に、判断OSとして使う哲学や過去判断を参照する。 Apply When: Slack返信、提案書、商談後の整理を作る時。 Do Not Apply When: 単なる事実確認だけで判断が不要な時。'
                        }]
                    };
                }
            }
        });

        expect(extracted.adopted).toEqual(expect.arrayContaining([
            expect.objectContaining({
                source_system: SOURCE_SYSTEM,
                sensitivity: 'internal',
                body: expect.stringContaining('判断OS')
            })
        ]));
        expect(extracted.agent_reports).toEqual(expect.arrayContaining([
            expect.objectContaining({
                role: 'semantic_personal_kg_extractor',
                status: 'completed',
                output_count: 2
            })
        ]));
    });
});
