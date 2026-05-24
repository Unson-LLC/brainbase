// @ts-check
import { describe, expect, it } from 'vitest';

import { parseArgs, reviewPackToLedgerPayload } from '../../../scripts/import-sns-review-pack-to-ledger.js';

describe('import-sns-review-pack-to-ledger', () => {
    it('maps ohayo reviewPack posts into ledger drafts', () => {
        const payload = reviewPackToLedgerPayload({
            reviewPack: {
                date: '2026-05-13',
                posts: [{
                    slot: 'peer_quote_1',
                    time: '18:00',
                    scheduled_at: '2026-05-13T09:00:00.000Z',
                    lane: 'peer_circle',
                    topic: 'Claude Code',
                    body: 'これ、Claude Codeを会社で使う時も同じだと思ってる',
                    source_url: 'https://x.com/near/status/1',
                    persona_brain: { target_person: 'AI導入を任されたPM' },
                    algorithm_fit: { candidate_source: 'peer_circle_quote' },
                    generation_context_evidence: { policy_ref: 'generation_policy', recommended_lanes: ['peer_circle'] },
                    graph_check: { decision: 'checked_for_review' },
                    quality_gate: { decision: 'pass', persona_affect: { likely_reader_feeling: '現場に接続できる' } }
                }]
            }
        });

        expect(payload.account_handle).toBe('@AIBizNavigator');
        expect(payload.drafts).toHaveLength(1);
        expect(payload.drafts[0]).toMatchObject({
            id: 'ohayo_2026-05-13_peer_quote_1',
            date: '2026-05-13',
            slot_index: 1,
            time: '18:00',
            scheduled_at: '2026-05-13T09:00:00.000Z',
            lane: 'peer_circle',
            format: 'quote_repost_commentary',
            source_type: 'Peer Circle',
            source_url: 'https://x.com/near/status/1'
        });
        expect(payload.drafts[0].quality_gate.decision).toBe('pass');
        expect(payload.drafts[0].algorithm_fit.candidate_source).toBe('peer_circle_quote');
        expect(payload.drafts[0].generation_context_evidence.policy_ref).toBe('generation_policy');
    });

    it('parses base-url and dry-run arguments', () => {
        expect(parseArgs(['--date', '2026-05-13', '--base-url', 'http://localhost:3999', '--dry-run'])).toMatchObject({
            date: '2026-05-13',
            baseUrl: 'http://localhost:3999',
            dryRun: true
        });
    });
});
