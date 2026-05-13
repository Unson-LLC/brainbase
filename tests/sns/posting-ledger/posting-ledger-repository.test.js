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
    safety: {
        persona_affect: {
            likely_reader_feeling: '自分の現場の迷いを言語化されたと感じる',
            decision: 'pass',
            negative_feeling_risks: []
        }
    }
};

describe('InMemorySnsPostingLedgerRepository', () => {
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
        expect(posts[0].source.type).toBe('Personal KG');
        expect(posts[0].evidence.persona_brain.target_person).toContain('AI導入');
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
                            date: params[4],
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
                            source: JSON.parse(params[15]),
                            evidence: JSON.parse(params[16]),
                            memo: params[17],
                            learning_candidate_id: params[18],
                            revisions: JSON.parse(params[19]),
                            metrics_snapshots: JSON.parse(params[20]),
                            created_at: params[21],
                            updated_at: params[22]
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
        expect(result.created[0].source.type).toBe('Peer Circle');
        expect(result.created[0].source.url).toBe('https://x.com/near/status/1');
        expect(result.created[0].evidence.persona_brain.target_person).toContain('AI導入');
        expect(calls.some((call) => call.sql.includes('sns_posting_ledger_posts'))).toBe(true);
    });
});
