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

describe('sns ohayo brief', () => {
    it('classifies near-peer authors before mega accounts', () => {
        expect(classifyAuthorBand({ author_followers: 1999 })).toBe('out_of_band');
        expect(classifyAuthorBand({ author_followers: 8200 })).toBe('primary');
        expect(classifyAuthorBand({ author_followers: 34000 })).toBe('secondary');
        expect(classifyAuthorBand({ author_followers: 220000 })).toBe('out_of_band');
        expect(classifyAuthorBand({})).toBe('unknown');
    });

    it('builds a low-cost daily brief with persona affect gates, review pack, and weekly-pack signals', () => {
        const jpTweets = JSON.parse(fs.readFileSync(jpFixture, 'utf8'));
        const enTweets = JSON.parse(fs.readFileSync(enFixture, 'utf8'));

        const brief = buildBrief({
            date: '2026-05-12',
            jpTweets,
            enTweets,
            jpReads: 10,
            enReads: 10,
            weeklyPlan: '## Tue 2026-05-12\n\nBaseline:\n1. Own Proof\n2. Claude Code法人導入'
        });

        expect(brief.summary.total_reads).toBe(20);
        expect(brief.summary.estimated_cost_usd).toBe(0.1);
        expect(brief.summary.blocked_persona_affect).toBe(0);
        expect(brief.signals.peerSignals).toHaveLength(1);
        expect(brief.signals.peerSignals[0]).toMatchObject({
            author_handle: '@near_ai_pm',
            author_followers: 8200,
            target_band: 'primary',
            topic: 'Claude Code'
        });
        expect(brief.signals.reviewPack).toMatchObject({
            date: '2026-05-12',
            publish_intent: 'manual_review_only'
        });
        expect(brief.signals.reviewPack.posts).toHaveLength(4);
        expect(brief.signals.reviewPack.posts.map((post) => post.slot)).toEqual([
            'baseline_1',
            'baseline_2',
            'peer_quote_1',
            'news_commentary_1'
        ]);
        expect(brief.signals.reviewPack.posts.every((post) => post.quality_gate.decision === 'pass')).toBe(true);
        expect(brief.signals.reviewPack.posts.every((post) => post.graph_check?.scope === 'growth')).toBe(true);
        expect(brief.signals.reviewPack.posts.every((post) => post.persona_brain)).toBe(true);
        expect(brief.signals.reviewPack.posts.find((post) => post.slot === 'peer_quote_1').peer_circle_brain).toBeTruthy();
        expect(brief.signals.reviewPack.posts.find((post) => post.slot === 'news_commentary_1').amplifier_brain).toBeTruthy();
        expect(brief.signals.reviewPack.posts.map((post) => post.body).join('\n')).not.toMatch(/Persona Brain|Brain OS/u);
        expect(brief.markdown).toContain('Estimated X API cost: $0.10');
        expect(brief.markdown).toContain('Persona Affect: pass');
        expect(brief.markdown).toContain('## 今日のレビュー用投稿パック');
        expect(brief.markdown).toContain('## Graph Check');
        expect(brief.markdown).toContain('Baseline 1');
        expect(brief.markdown).toContain('Peer Quote 1');
        expect(brief.markdown).toContain('Claude Codeを会社で使う時');
        expect(brief.markdown).not.toMatch(/少し上の人に絡む|相手の読者に入る|APIで投稿/);
        expect(brief.markdown).not.toMatch(/これめちゃ分かる\s+これめちゃ分かる/u);
        expect(brief.markdown).not.toMatch(/ルー大柴|manual review only.*本文/u);
    });

    it('does not promote weak peer/news signals into the review pack', () => {
        const jpTweets = JSON.parse(fs.readFileSync(jpFixture, 'utf8')).map((tweet) => ({
            ...tweet,
            author_followers: 900
        }));
        const enTweets = JSON.parse(fs.readFileSync(enFixture, 'utf8')).map((tweet) => ({
            ...tweet,
            author_followers: 30
        }));

        const brief = buildBrief({
            date: '2026-05-12',
            jpTweets,
            enTweets,
            jpReads: 10,
            enReads: 10,
            weeklyPlan: '## Tue 2026-05-12\n\nBaseline:\n1. Own Proof\n2. Claude Code法人導入'
        });

        const slots = brief.signals.reviewPack.posts.map((post) => post.slot);
        expect(slots).toEqual(['baseline_1', 'baseline_2']);
        expect(brief.markdown).toContain('Peer Quote: quality hold');
        expect(brief.markdown).toContain('News Commentary: quality hold');
    });

    it('CLI writes markdown and signals files from fixture inputs without calling X API', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sns-ohayo-brief-'));
        const out = path.join(dir, 'brief.md');
        const signalsOut = path.join(dir, 'signals.json');
        const stdout = execFileSync('node', [
            'scripts/generate-sns-ohayo-brief.js',
            '--date',
            '2026-05-12',
            '--jp-json',
            jpFixture,
            '--en-json',
            enFixture,
            '--out',
            out,
            '--signals-out',
            signalsOut
        ], {
            cwd: root,
            encoding: 'utf8'
        });

        const result = JSON.parse(stdout);
        expect(result.out).toBe(out);
        expect(result.signalsOut).toBe(signalsOut);
        expect(fs.readFileSync(out, 'utf8')).toContain('SNS Ohayo Brief 2026-05-12');
        const signals = JSON.parse(fs.readFileSync(signalsOut, 'utf8'));
        expect(signals.peerSignals[0].author_handle).toBe('@near_ai_pm');
        expect(signals.newsSignals[0].author_handle).toBe('@ai_workflows');
        expect(signals.reviewPack.posts).toHaveLength(4);
        expect(signals.reviewPack.posts[0].body).not.toContain('APIで投稿');
    });
});
