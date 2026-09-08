// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { buildBrief, classifyAuthorBand } from '../../../scripts/generate-sns-ohayo-brief.js';

const root = path.resolve(import.meta.dirname, '../../..');
const jpFixture = path.join(root, 'tests/fixtures/sns-ohayo-brief/jp-peer.json');
const enFixture = path.join(root, 'tests/fixtures/sns-ohayo-brief/en-news.json');

function generationContextFixture(entries = [
    {
        id: 'lifelog_work_1',
        body: '今日はXの方針を全部見直した。人に助言する文章より、自分の記録を残す方がしっくりきた。',
        source_system: 'oyasumi-meeting-personal-kg',
        category: 'work_log',
        occurred_at: '2026-07-28T08:00:00.000Z',
        evidence_ids: [{ uri: 'brainbase:test:lifelog_work_1' }]
    }
]) {
    return {
        date: '2026-07-28',
        personal_kg: {
            retrieval_purpose: 'public_lifelog_generation',
            lifelog_entries: entries
        },
        generation_policy: {
            mode: 'public_lifelog',
            recommended_lanes: ['today_log', 'work_log', 'life_log', 'memory', 'unresolved'],
            avoid_patterns: ['advice_or_instruction', 'cta_or_conversion'],
            recent_history: {
                blocked_body_fingerprints: []
            }
        },
        evidence: [
            { kind: 'candidate_store', ref: 'memory_candidates owner:sato_keigo' }
        ]
    };
}

describe('sns ohayo public lifelog brief', () => {
    it('keeps the legacy author-band observation helper stable', () => {
        expect(classifyAuthorBand({ author_followers: 1999 })).toBe('out_of_band');
        expect(classifyAuthorBand({ author_followers: 8200 })).toBe('primary');
        expect(classifyAuthorBand({ author_followers: 34000 })).toBe('secondary');
        expect(classifyAuthorBand({ author_followers: 220000 })).toBe('out_of_band');
        expect(classifyAuthorBand({})).toBe('unknown');
    });

    it('builds posts only from first-person lifelog entries', () => {
        const jpTweets = JSON.parse(fs.readFileSync(jpFixture, 'utf8'));
        const enTweets = JSON.parse(fs.readFileSync(enFixture, 'utf8'));
        const context = generationContextFixture();

        const brief = buildBrief({
            date: '2026-07-28',
            jpTweets,
            enTweets,
            jpReads: 10,
            enReads: 10,
            weeklyPlan: '旧週次計画は生成に使わない',
            generationContext: context
        });

        expect(brief.summary).toMatchObject({
            total_reads: 20,
            estimated_cost_usd: 0.1,
            generation_context_used: true,
            review_pack_posts: 1,
            blocked_lifelog_integrity: 0,
            no_first_person_source: false
        });
        expect(brief.signals.reviewPack).toMatchObject({
            mode: 'public_lifelog',
            publish_intent: 'manual_review_only'
        });
        expect(brief.signals.reviewPack.posts).toHaveLength(1);
        expect(brief.signals.reviewPack.posts[0]).toMatchObject({
            slot: 'lifelog_1',
            lane: 'work_log',
            format: 'first_person_lifelog',
            body: context.personal_kg.lifelog_entries[0].body,
            quality_gate: {
                decision: 'pass',
                check_type: 'lifelog_integrity'
            },
            lifelog_check: {
                source_id: 'lifelog_work_1',
                first_person_evidence: true
            },
            graph_check: {
                scope: 'personal_experience',
                decision: 'source_attached'
            }
        });
        expect(brief.signals.reflectionPrompts.length).toBeGreaterThan(0);
        expect(brief.signals.reflectionPrompts.every((prompt) => prompt.may_become_post_without_first_person_source === false)).toBe(true);
        expect(brief.signals.reviewPack.posts.map((post) => post.body).join('\n')).not.toContain(jpTweets[0].text);
        expect(brief.markdown).toContain('## 今日の公開ライフログ候補');
        expect(brief.markdown).toContain('## 外部情報からの内省プロンプト（投稿案ではない）');
        expect(brief.markdown).not.toContain('旧週次計画');
    });

    it('returns zero posts when there is no first-person source, even with strong external signals', () => {
        const brief = buildBrief({
            date: '2026-07-28',
            jpTweets: JSON.parse(fs.readFileSync(jpFixture, 'utf8')),
            enTweets: JSON.parse(fs.readFileSync(enFixture, 'utf8')),
            generationContext: generationContextFixture([])
        });

        expect(brief.signals.reviewPack.posts).toEqual([]);
        expect(brief.summary.no_first_person_source).toBe(true);
        expect(brief.markdown).toContain('候補なし（本人の一次体験ソースなし');
    });

    it('holds advice and recent duplicate sources instead of rewriting them', () => {
        const advice = '今日は考えた。みんなも毎日記録すべきだ。';
        const duplicate = '今日は同じことを考えた。';
        const context = generationContextFixture([
            { id: 'advice', body: advice, category: 'daily_log' },
            { id: 'duplicate', body: duplicate, category: 'daily_log' }
        ]);
        context.generation_policy.recent_history.blocked_body_fingerprints = ['今日は同じことを考えた'];

        const brief = buildBrief({
            date: '2026-07-28',
            jpTweets: [],
            enTweets: [],
            generationContext: context
        });

        expect(brief.signals.reviewPack.posts).toEqual([]);
        expect(brief.signals.reviewPack.holds).toEqual(expect.arrayContaining([
            expect.objectContaining({ source_id: 'advice', reasons: ['advice_or_instruction'] }),
            expect.objectContaining({ source_id: 'duplicate', reasons: ['duplicate_recent_body'] })
        ]));
    });

    it('CLI exits with the retirement code before reading or writing files', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sns-lifelog-brief-'));
        const out = path.join(dir, 'brief.md');
        const signalsOut = path.join(dir, 'signals.json');
        const generationContext = path.join(dir, 'generation-context.json');
        fs.writeFileSync(generationContext, JSON.stringify(generationContextFixture(), null, 2));

        let error;
        try {
            execFileSync('node', [
                'scripts/generate-sns-ohayo-brief.js',
                '--date',
                '2026-07-28',
                '--jp-json',
                jpFixture,
                '--en-json',
                enFixture,
                '--generation-context',
                generationContext,
                '--out',
                out,
                '--signals-out',
                signalsOut
            ], {
                cwd: root,
                encoding: 'utf8'
            });
        } catch (caught) {
            error = caught;
        }
        expect(error).toMatchObject({ status: 1 });
        expect(error.stderr.toString()).toContain('SNS_CLI_RETIRED');
        expect(error.stdout.toString()).toBe('');
        expect(fs.existsSync(out)).toBe(false);
        expect(fs.existsSync(signalsOut)).toBe(false);
    });
});
