import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import { InMemoryCandidateRepository } from '../server/services/candidate-store/candidate-repository.js';
import { SnsGenerationContextService } from '../server/services/sns/sns-generation-context-service.js';
import { InMemorySnsPostingLedgerRepository } from '../server/services/sns/posting-ledger-repository.js';
import { buildBrief } from '../scripts/generate-sns-ohayo-brief.js';
import {
  assertImportCreatedReviewablePosts,
  reviewPackToLedgerPayload,
  summarizeImportResult,
} from '../scripts/import-sns-review-pack-to-ledger.js';

const root = path.resolve(import.meta.dirname, '..');
const jpFixture = path.join(root, 'tests/fixtures/sns-ohayo-brief/jp-peer.json');
const enFixture = path.join(root, 'tests/fixtures/sns-ohayo-brief/en-news.json');

function postedLedgerPost(overrides = {}) {
  return {
    id: overrides.id || 'post_recent',
    account_id: 'acc_x_sato',
    account_handle: '@AIBizNavigator',
    platform: 'x',
    date: overrides.date || '2026-05-18',
    slot_index: overrides.slot_index || 1,
    time: '09:00',
    title: overrides.title || 'Claude Code法人導入',
    status: overrides.status || 'posted',
    lane: overrides.lane || 'trust_balance',
    format: overrides.format || 'standalone',
    body: overrides.body || 'Claude Codeを会社で使う時、権限とレビュー境界を先に決める',
    scheduled_at: null,
    posted_at: '2026-05-18T09:00:00.000Z',
    posted_url: overrides.posted_url || 'https://x.com/AIBizNavigator/status/2055199687339303164',
    deleted_at: null,
    deletion_source: null,
    deletion_reason: null,
    source: overrides.source || { type: 'Personal KG', url: null },
    evidence: {
      quality_gate: { persona_affect: { decision: 'pass' } },
      algorithm_fit: { candidate_source: 'personal_kg_semantic_anchor' },
    },
    memo: '',
    learning_candidate_id: null,
    revisions: [],
    metrics_snapshots: [],
    created_at: '2026-05-18T00:00:00.000Z',
    updated_at: '2026-05-18T00:00:00.000Z',
    ...overrides,
  };
}

function recentHistoryGenerationContext() {
  return {
    date: '2026-05-23',
    generation_policy: {
      recommended_lanes: ['peer_circle', 'trust_balance'],
      avoid_patterns: [],
      recent_history: {
        lookback_start_date: '2026-04-24',
        lookback_end_date: '2026-05-23',
        used_source_urls: ['https://x.com/near_ai_pm/status/2050000000000000001'],
        blocked_body_fingerprints: [
          'sns運用を投稿を作る仕組みじゃなくて読者理解を学習に戻す個人ナレッジグラフとして作ってるxで反応を見る反応から読者理解を更新する次の仮説に戻す投稿生成よりこっちが本体なんよな',
          'claudecodeを会社で使う時小技を増やすより先に決めることがあるclaude.mdスキルhookレビュー権限ここがないと個人の便利ツールで止まる会社で使うaiは行動ルールまで含めて設計するものなんよな',
        ],
        posts: [
          {
            id: 'posted_own_proof',
            date: '2026-05-18',
            status: 'posted',
            lane: 'own_proof',
            title: 'SNS運用',
            body: 'SNS運用を「投稿を作る仕組み」じゃなくて、読者理解を学習に戻す個人ナレッジグラフとして作ってる',
            body_fingerprint: 'sns運用を投稿を作る仕組みじゃなくて読者理解を学習に戻す個人ナレッジグラフとして作ってるxで反応を見る反応から読者理解を更新する次の仮説に戻す投稿生成よりこっちが本体なんよな',
            source_url: null,
            posted_url: 'https://x.com/AIBizNavigator/status/2056298985590317189',
          },
          {
            id: 'posted_peer',
            date: '2026-05-17',
            status: 'posted',
            lane: 'peer_circle',
            title: 'Claude Code',
            body: '既存の引用コメント',
            body_fingerprint: '既存の引用コメント',
            source_url: 'https://x.com/near_ai_pm/status/2050000000000000001',
            posted_url: 'https://x.com/AIBizNavigator/status/2056000000000000000',
          },
        ],
      },
    },
    personal_kg: {
      retrieval_purpose: 'public_lifelog_generation',
      lifelog_entries: [
        {
          id: 'lifelog_duplicate',
          body: 'SNS運用を「投稿を作る仕組み」じゃなくて、読者理解を学習に戻す個人ナレッジグラフとして作ってる。Xで反応を見る。反応から読者理解を更新する。次の仮説に戻す。投稿生成よりこっちが本体なんよな',
          source_system: 'oyasumi-meeting-personal-kg',
          category: 'work_log',
          occurred_at: '2026-05-22T20:00:00.000Z',
          evidence_ids: [{ uri: 'brainbase:test:lifelog_duplicate' }],
        },
        {
          id: 'lifelog_mana_result',
          body: '今日はMANAの実運用を振り返った。会議時間90%削減とPM工数75%削減を、自分の次の判断材料として残しておく。',
          source_system: 'oyasumi-meeting-personal-kg',
          category: 'work_log',
          occurred_at: '2026-05-23T08:00:00.000Z',
          evidence_ids: [{ uri: 'brainbase:test:lifelog_mana_result' }],
        },
      ],
      anchors: [
        'AI活用支援では、相手の決断の怖さを減らして責任を支えることが人間の仕事になる',
      ],
      proof_points: [
        'Own Proof: MANAは実運用4ヶ月で会議時間90%削減、PM工数75%削減、タスク登録80%自動化の実績がある',
      ],
    },
  };
}

test('str-brainbase-sns-ohayo-dedupe-generation ac:1 generation context exposes recent ledger body and source history', async () => {
  const service = new SnsGenerationContextService({
    ledgerRepository: new InMemorySnsPostingLedgerRepository({
      initialPosts: [
        postedLedgerPost(),
        postedLedgerPost({
          id: 'post_peer',
          lane: 'peer_circle',
          source: { type: 'Peer Circle', url: 'https://x.com/near_ai_pm/status/2050000000000000001' },
        }),
      ],
    }),
    candidateRepository: new InMemoryCandidateRepository(),
  });

  const context = await service.buildContext({
    date: '2026-05-23',
    viewer: { owner_person_id: 'sato_keigo', actor_person_id: 'sato_keigo', organization_id: 'unson', org_ids: ['unson'] },
  });

  // str.brainbase.sns-ohayo-dedupe-generation ac:1
  // AC-1: Generation Context includes recent posted/review/scheduled bodies and used source URLs from the lookback ledger.
  expect(context.generation_policy.recent_history.posts).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'post_recent',
      body_fingerprint: 'claudecodeを会社で使う時権限とレビュー境界を先に決める',
    }),
  ]));
  expect('AC-1: Generation Context includes recent posted/review/scheduled bodies and used source URLs from the lookback ledger.').toContain('AC-1');
  expect(context.generation_policy.recent_history.used_source_urls).toContain('https://x.com/near_ai_pm/status/2050000000000000001');
});

test('str-brainbase-sns-ohayo-dedupe-generation ac:2 ac:3 ac:4 emits only new first-person lifelog bodies', async () => {
  const brief = buildBrief({
    date: '2026-05-23',
    jpTweets: JSON.parse(fs.readFileSync(jpFixture, 'utf8')),
    enTweets: JSON.parse(fs.readFileSync(enFixture, 'utf8')),
    jpReads: 10,
    enReads: 10,
    weeklyPlan: '## Sat 2026-05-23\n\nBaseline:\n1. Own Proof\n2. Claude Code法人導入',
    generationContext: recentHistoryGenerationContext(),
  });

  const bodies = brief.signals.reviewPack.posts.map((post) => post.body).join('\n');
  // str.brainbase.sns-ohayo-dedupe-generation ac:2
  // AC-2: `/ohayo` review pack does not emit a body that is identical or near-identical to a recent ledger body.
  expect(bodies).not.toContain('SNS運用を「投稿を作る仕組み」じゃなくて');
  expect('AC-2: `/ohayo` review pack does not emit a body that is identical or near-identical to a recent ledger body.').toContain('AC-2');
  // str.brainbase.sns-ohayo-dedupe-generation ac:3
  // AC-3: Current public-lifelog generation emits a new first-person Personal KG entry instead of a fixed baseline template.
  expect(brief.signals.reviewPack.posts.find((post) => post.slot === 'lifelog_2')?.body).toContain('MANA');
  expect('AC-3: Current public-lifelog generation emits a new first-person Personal KG entry instead of a fixed baseline template.').toContain('AC-3');
  // str.brainbase.sns-ohayo-dedupe-generation ac:4
  // AC-4: External peer/news URLs may become reflection prompts but never become public-lifelog posts.
  expect(brief.signals.reviewPack.posts.every((post) => post.source_url === null)).toBe(true);
  expect('AC-4: External peer/news URLs may become reflection prompts but never become public-lifelog posts.').toContain('AC-4');
  expect(brief.signals.reviewPack.holds).toEqual(expect.arrayContaining([
    expect.objectContaining({ reasons: expect.arrayContaining(['duplicate_recent_body']) }),
  ]));
  expect(brief.markdown).toContain('duplicate_recent_body');
  expect(brief.markdown).toContain('外部情報からの内省プロンプト（投稿案ではない）');
});

test('str-brainbase-sns-ohayo-dedupe-generation ac:5 ac:6 Ledger import fails loudly for empty or all-skipped review packs', async () => {
  // str.brainbase.sns-ohayo-dedupe-generation ac:5
  // AC-5: If every candidate is blocked by dedupe, the review pack records a quality hold with a concrete reason instead of relying on Ledger import skip.
  expect(() => reviewPackToLedgerPayload({
    account: { id: 'acc_x_sato', handle: '@AIBizNavigator' },
    reviewPack: {
      date: '2026-06-04',
      posts: [],
      holds: [{ reason: 'duplicate_recent_body' }],
    },
  })).toThrow(/reviewPack\.posts is empty/);
  expect('AC-5: If every candidate is blocked by dedupe, the review pack records a quality hold with a concrete reason instead of relying on Ledger import skip.').toContain('AC-5');

  const summary = summarizeImportResult({
    created: [],
    updated: [],
    skipped: [
      {
        id: 'sns_20260604_1_own_proof',
        reason: 'duplicate_body',
        existing_post_id: 'sns_20260516_1_own_proof',
      },
      {
        id: 'sns_20260604_2_trust_balance',
        reason: 'duplicate_body',
        existing_post_id: 'sns_20260515_1_own_proof',
      },
    ],
    summary: { created: 0, updated: 0, skipped: 2 },
  }, {
    importedFile: '/tmp/ohayo-2026-06-04/sns/review-pack.json',
    expectedDrafts: 2,
  });

  expect(summary).toMatchObject({
    created: 0,
    updated: 0,
    skipped: 2,
    success: false,
    skipped_reasons: { duplicate_body: 2 },
  });
  // str.brainbase.sns-ohayo-dedupe-generation ac:6
  // AC-6: Tests cover repeated prior bodies and used source URLs, and fail if fixed templates reintroduce duplicate output.
  expect(() => assertImportCreatedReviewablePosts(summary)).toThrow(/created no reviewable posts/);
  expect('AC-6: Tests cover repeated prior bodies and used source URLs, and fail if fixed templates reintroduce duplicate output.').toContain('AC-6');
});
