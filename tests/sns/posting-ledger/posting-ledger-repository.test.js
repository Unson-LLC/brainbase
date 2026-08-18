// @ts-check
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    InvalidSnsPostTransitionError,
    InMemorySnsPostingLedgerRepository,
    JsonFileSnsPostingLedgerRepository,
    PgSnsPostingLedgerRepository
} from '../../../server/services/sns/posting-ledger-repository.js';

const baseDraft = {
    id: 'week_2026-05-18_1_trust_balance',
    date: '2026-05-18',
    slot_index: 1,
    lane: 'trust_balance',
    format: 'standalone',
    body: 'Claude Code法人導入で差がつくのは、運用設計だと思う',
    kg_source_entity_id: 'candidate:claude-code',
    source_candidate_id: 'claude-code',
    derived_from: ['candidate:claude-code'],
    evidence_ids: [{ uri: 'brainbase:test:claude-code' }],
    persona_brain: {
        target_person: 'AI導入を任された事業責任者 / PM / 経営者',
        current_situation: 'Claude Codeに関心がある',
        existing_belief: '良いツールを入れれば進む',
        misunderstanding: 'AI活用はツール選定の問題',
        fear: '事故時の責任境界が怖い',
        blocker: '権限とレビュー境界が分からない',
        resonant_detail: '現場、権限、レビュー',
        avoid_phrasing: '全部自動化できます',
        natural_next_action: '自社の最初の1業務を考える',
        success_signal: 'bookmark_or_profile_visit'
    },
    algorithm_fit: {
        decision: 'reviewable',
        candidate_source: 'personal_kg_semantic_anchor',
        predicted_positive_actions: ['bookmark', 'profile_click', 'dwell'],
        predicted_negative_actions: [],
        negative_feedback_risks: [],
        author_diversity: {
            scope: 'weekly_pack',
            repeated_author_handle: null,
            policy: 'avoid same-day KG source reuse'
        },
        graph_edge_goal: 'bookmark_or_profile_visit:trust_balance'
    },
    generation_context_evidence: {
        policy_ref: 'generation_policy',
        recommended_lanes: ['trust_balance', 'peer_circle']
    },
    safety: {
        persona_affect: {
            likely_reader_feeling: '自分の現場の迷いを言語化されたと感じる',
            decision: 'pass',
            negative_feeling_risks: []
        }
    }
};

describe('InMemorySnsPostingLedgerRepository', () => {
    it('AC-005 persists only the canonical background job tenant binding with the scheduled row', () => {
        const repository = new InMemorySnsPostingLedgerRepository();
        const tenantBoundary = {
            tenant_context: {
                tenant: {
                    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
                    tenant_revision: '7'
                }
            },
            resource_ref: { object_type: 'project', resource_id: 'project_sns' }
        };

        repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            drafts: [{ ...baseDraft, tenant_boundary: tenantBoundary }]
        });

        expect(repository.listPosts({})[0].evidence.tenant_boundary).toEqual(tenantBoundary);
        expect(JSON.stringify(repository.listPosts({})[0])).not.toMatch(/credential|secret|token/iu);
    });

    it('AC-005 re-imports a canonical binding onto an existing mutable row', () => {
        const repository = new InMemorySnsPostingLedgerRepository();
        const tenantBoundary = {
            tenant_context: {
                tenant: {
                    tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
                    tenant_revision: '7'
                }
            },
            resource_ref: { object_type: 'project', resource_id: 'project_sns' }
        };
        repository.upsertReviewPack({ account_id: 'acc_x_sato', drafts: [baseDraft] });

        const result = repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            drafts: [{ ...baseDraft, tenant_boundary: tenantBoundary }]
        });

        expect(result.updated).toHaveLength(1);
        expect(repository.listPosts({})[0].evidence.tenant_boundary).toEqual(tenantBoundary);
    });

    it('upserts a weekly review pack idempotently by date and slot', () => {
        const repository = new InMemorySnsPostingLedgerRepository();

        const first = repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            account_handle: '@AIBizNavigator',
            drafts: [baseDraft]
        });
        const second = repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            account_handle: '@AIBizNavigator',
            drafts: [{ ...baseDraft, body: 'edited by generation rerun' }]
        });

        expect(first.created).toHaveLength(1);
        expect(second.created).toHaveLength(0);
        expect(second.updated).toHaveLength(1);

        const posts = repository.listPosts({ startDate: '2026-05-18', endDate: '2026-05-18' });
        expect(posts).toHaveLength(1);
        expect(posts[0].body).toBe('edited by generation rerun');
        expect(posts[0].status).toBe('review_needed');
        expect(posts[0].time).toBe('09:00');
        expect(posts[0].scheduled_at).toBe('2026-05-18T00:00:00.000Z');
        expect(posts[0].source.type).toBe('Personal KG');
        expect(posts[0].evidence.persona_brain.target_person).toContain('AI導入');
        expect(posts[0].evidence.algorithm_fit).toMatchObject({
            decision: 'reviewable',
            candidate_source: 'personal_kg_semantic_anchor',
            graph_edge_goal: 'bookmark_or_profile_visit:trust_balance'
        });
        expect(posts[0].evidence.generation_context_evidence.policy_ref).toBe('generation_policy');
    });

    it('treats generated date and time as JST when deriving scheduled_at', () => {
        const repository = new InMemorySnsPostingLedgerRepository();

        repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            drafts: [{
                ...baseDraft,
                date: '2026-05-24',
                slot_index: 4,
                time: '18:00'
            }]
        });

        const post = repository.listPosts({})[0];
        expect(post.time).toBe('18:00');
        expect(post.scheduled_at).toBe('2026-05-24T09:00:00.000Z');
    });

    it('preserves an explicit scheduled_at instant instead of reinterpreting it as JST', () => {
        const repository = new InMemorySnsPostingLedgerRepository();

        repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            drafts: [{
                ...baseDraft,
                date: '2026-05-24',
                time: '18:00',
                scheduled_at: '2026-05-24T18:00:00.000Z'
            }]
        });

        expect(repository.listPosts({})[0].scheduled_at).toBe('2026-05-24T18:00:00.000Z');
    });

    it('stores body revisions and explicit operational status transitions', () => {
        const repository = new InMemorySnsPostingLedgerRepository();
        repository.upsertReviewPack({ account_id: 'acc_x_sato', drafts: [baseDraft] });
        const post = repository.listPosts({})[0];

        const edited = repository.updatePost(post.id, {
            body: '会社でClaude Codeを使うなら、権限とレビュー境界を先に決める',
            status: 'approved'
        }, { actor_person_id: 'sato_keigo' });

        expect(edited.status).toBe('approved');
        expect(edited.body).toContain('権限とレビュー境界');
        expect(edited.revisions).toHaveLength(1);
        expect(edited.revisions[0].previous_body).toContain('運用設計');

        const scheduled = repository.updatePost(post.id, {
            status: 'scheduled',
            scheduled_at: '2026-05-18T00:00:00.000Z'
        }, { actor_person_id: 'sato_keigo' });
        expect(scheduled.status).toBe('scheduled');
        expect(scheduled.scheduled_at).toBe('2026-05-18T00:00:00.000Z');
    });

    it('rejects invalid status transitions before mutating the ledger', () => {
        const repository = new InMemorySnsPostingLedgerRepository();
        repository.upsertReviewPack({ account_id: 'acc_x_sato', drafts: [baseDraft] });
        const post = repository.listPosts({})[0];

        expect(() => repository.updatePost(post.id, { status: 'posted' }, { actor_person_id: 'sato_keigo' }))
            .toThrow(InvalidSnsPostTransitionError);
        expect(repository.findById(post.id)?.status).toBe('review_needed');
    });

    it('skips duplicate body text already reserved by another live ledger row', () => {
        const repository = new InMemorySnsPostingLedgerRepository();
        const postedBody = [
            'Claude Codeを会社で使う時、小技を増やすより先に決めることがある',
            '',
            'CLAUDE.md、スキル、hook、レビュー、権限'
        ].join('\n');

        repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            drafts: [{
                ...baseDraft,
                date: '2026-05-13',
                slot_index: 2,
                body: postedBody
            }]
        });

        const result = repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            drafts: [{
                ...baseDraft,
                date: '2026-05-18',
                slot_index: 1,
                body: `  ${postedBody.replace('hook', 'hook')}  `
            }]
        });

        expect(result.created).toHaveLength(0);
        expect(result.updated).toHaveLength(0);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0]).toMatchObject({
            reason: 'duplicate_body',
            existing_post_id: 'sns_20260513_2_trust_balance'
        });
        expect(repository.listPosts({ startDate: '2026-05-18', endDate: '2026-05-18' })).toHaveLength(0);
    });

    it('does not overwrite posted rows when a review pack reuses the same account date and slot', () => {
        const repository = new InMemorySnsPostingLedgerRepository();
        repository.upsertReviewPack({ account_id: 'acc_x_sato', drafts: [baseDraft] });
        let post = repository.updatePost(repository.listPosts({})[0].id, { status: 'approved' }, { actor_person_id: 'sato_keigo' });
        post = repository.updatePost(post.id, { status: 'scheduled' }, { actor_person_id: 'sato_keigo' });
        post = repository.updatePost(post.id, {
            status: 'posted',
            posted_url: 'https://x.com/AIBizNavigator/status/2055199687339303164',
            posted_at: '2026-05-15T08:12:43.000Z'
        }, { actor_person_id: 'sato_keigo' });

        const result = repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            drafts: [{
                ...baseDraft,
                body: 'new generated copy should not replace public history'
            }]
        });

        expect(result.created).toHaveLength(0);
        expect(result.updated).toHaveLength(0);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0].reason).toBe('immutable_status');
        expect(repository.findById(post.id)).toMatchObject({
            status: 'posted',
            body: baseDraft.body,
            posted_url: 'https://x.com/AIBizNavigator/status/2055199687339303164'
        });
    });

    it('marks a posted record as deleted while preserving the posted URL and deletion metadata', () => {
        const repository = new InMemorySnsPostingLedgerRepository();
        repository.upsertReviewPack({ account_id: 'acc_x_sato', drafts: [baseDraft] });
        let post = repository.updatePost(repository.listPosts({})[0].id, { status: 'approved' }, { actor_person_id: 'sato_keigo' });
        post = repository.updatePost(post.id, { status: 'scheduled' }, { actor_person_id: 'sato_keigo' });
        post = repository.updatePost(post.id, {
            status: 'posted',
            posted_url: 'https://x.com/AIBizNavigator/status/2055000000000000001',
            posted_at: '2026-05-14T03:00:00.000Z'
        }, { actor_person_id: 'sato_keigo' });

        const deleted = repository.updatePost(post.id, {
            status: 'deleted',
            deleted_at: '2026-05-14T04:00:00.000Z',
            deletion_source: 'manual_x_delete',
            deletion_reason: 'X上で削除した'
        }, { actor_person_id: 'sato_keigo' });

        expect(deleted).toMatchObject({
            status: 'deleted',
            posted_url: 'https://x.com/AIBizNavigator/status/2055000000000000001',
            posted_at: '2026-05-14T03:00:00.000Z',
            deleted_at: '2026-05-14T04:00:00.000Z',
            deletion_source: 'manual_x_delete',
            deletion_reason: 'X上で削除した'
        });
        expect(repository.findById(post.id)?.status).toBe('deleted');
    });

    it('persists the ledger to a JSON file across repository instances', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'sns-ledger-'));
        const filePath = path.join(dir, 'ledger.json');
        try {
            const writer = new JsonFileSnsPostingLedgerRepository({ filePath });
            writer.upsertReviewPack({ account_id: 'acc_x_sato', drafts: [baseDraft] });
            const post = writer.listPosts({})[0];
            writer.updatePost(post.id, { status: 'approved' }, { actor_person_id: 'sato_keigo' });

            const reader = new JsonFileSnsPostingLedgerRepository({ filePath });
            const restored = reader.listPosts({});
            expect(restored).toHaveLength(1);
            expect(restored[0].status).toBe('approved');
            expect(restored[0].body).toContain('Claude Code法人導入');
            expect(restored[0].time).toBe('09:00');
            expect(restored[0].scheduled_at).toBe('2026-05-18T00:00:00.000Z');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('PgSnsPostingLedgerRepository', () => {
    it('uses the SNS posting ledger table and preserves source/evidence JSON', async () => {
        const calls = [];
        const pool = {
            async query(sql, params = []) {
                calls.push({ sql, params });
                if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
                if (sql.includes('SELECT id FROM sns_posting_ledger_posts')) return { rows: [] };
                if (sql.includes('INSERT INTO sns_posting_ledger_posts')) {
                    return {
                        rows: [{
                            id: params[0],
                            account_id: params[1],
                            account_handle: params[2],
                            platform: params[3],
                            date: new Date(2026, 4, 18),
                            slot_index: params[5],
                            time: params[6],
                            title: params[7],
                            status: params[8],
                            lane: params[9],
                            format: params[10],
                            body: params[11],
                            scheduled_at: params[12],
                            posted_at: params[13],
                            posted_url: params[14],
                            deleted_at: params[15],
                            deletion_source: params[16],
                            deletion_reason: params[17],
                            source: JSON.parse(params[18]),
                            evidence: JSON.parse(params[19]),
                            memo: params[20],
                            learning_candidate_id: params[21],
                            revisions: JSON.parse(params[22]),
                            metrics_snapshots: JSON.parse(params[23]),
                            created_at: params[24],
                            updated_at: params[25]
                        }]
                    };
                }
                if (sql.includes('SELECT * FROM sns_posting_ledger_posts')) return { rows: [] };
                throw new Error(`Unexpected SQL: ${sql}`);
            }
        };
        const repository = new PgSnsPostingLedgerRepository({ pool });

        const result = await repository.upsertReviewPack({
            account_id: 'acc_x_sato',
            account_handle: '@AIBizNavigator',
            drafts: [{
                ...baseDraft,
                lane: 'peer_circle',
                source_url: 'https://x.com/near/status/1'
            }]
        });

        expect(result.created).toHaveLength(1);
        expect(result.created[0].date).toBe('2026-05-18');
        expect(result.created[0].time).toBe('09:00');
        expect(result.created[0].scheduled_at).toBe('2026-05-18T00:00:00.000Z');
        expect(result.created[0].source.type).toBe('Peer Circle');
        expect(result.created[0].source.url).toBe('https://x.com/near/status/1');
        expect(result.created[0].evidence.persona_brain.target_person).toContain('AI導入');
        expect(result.created[0].evidence.generation_context_evidence.recommended_lanes).toContain('trust_balance');
        const insertParams = calls.find((call) => call.sql.includes('INSERT INTO sns_posting_ledger_posts'))?.params;
        expect(insertParams?.[6]).toBe('09:00');
        expect(insertParams?.[12]).toBe('2026-05-18T00:00:00.000Z');
        expect(calls.some((call) => call.sql.includes('sns_posting_ledger_posts'))).toBe(true);
    });

    it('updates existing Postgres rows with JST-derived scheduled_at on review-pack reruns', async () => {
        const existingRow = {
            id: 'sns_20260524_4_trust_balance',
            account_id: 'acc_x_sato',
            account_handle: '@AIBizNavigator',
            platform: 'x',
            date: new Date(2026, 4, 24),
            slot_index: 4,
            time: '18:00',
            title: 'old title',
            status: 'review_needed',
            lane: 'trust_balance',
            format: 'standalone',
            body: 'old body',
            scheduled_at: '2026-05-24T18:00:00.000Z',
            posted_at: null,
            posted_url: null,
            deleted_at: null,
            deletion_source: null,
            deletion_reason: null,
            source: {},
            evidence: {},
            memo: '',
            learning_candidate_id: null,
            revisions: [],
            metrics_snapshots: [],
            created_at: '2026-05-24T00:00:00.000Z',
            updated_at: '2026-05-24T00:00:00.000Z'
        };
        const calls = [];
        const pool = {
            async query(sql, params = []) {
                calls.push({ sql, params });
                if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
                if (sql.includes('WHERE account_id = $1 AND date = $2 AND slot_index = $3')) {
                    return { rows: [existingRow] };
                }
                if (sql.includes('status = ANY')) return { rows: [] };
                if (sql.includes('UPDATE sns_posting_ledger_posts')) {
                    return {
                        rows: [{
                            ...existingRow,
                            title: params[1],
                            body: params[2],
                            lane: params[3],
                            format: params[4],
                            account_handle: params[5],
                            source: JSON.parse(params[6]),
                            evidence: JSON.parse(params[7]),
                            time: params[8],
                            scheduled_at: params[9],
                            updated_at: '2026-05-24T01:00:00.000Z'
                        }]
                    };
                }
                throw new Error(`Unexpected SQL: ${sql}`);
            }
        };

        const result = await new PgSnsPostingLedgerRepository({ pool }).upsertReviewPack({
            account_id: 'acc_x_sato',
            account_handle: '@AIBizNavigator',
            drafts: [{
                ...baseDraft,
                date: '2026-05-24',
                slot_index: 4,
                time: '18:00',
                body: 'rerun body'
            }]
        });

        expect(result.updated).toHaveLength(1);
        expect(result.updated[0]).toMatchObject({
            id: 'sns_20260524_4_trust_balance',
            time: '18:00',
            scheduled_at: '2026-05-24T09:00:00.000Z',
            body: 'rerun body'
        });
        expect(calls.find((call) => call.sql.includes('UPDATE sns_posting_ledger_posts'))?.params.slice(8, 10))
            .toEqual(['18:00', '2026-05-24T09:00:00.000Z']);
    });
});
